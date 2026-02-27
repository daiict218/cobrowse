import { Transport } from './transport.js';
import { Capture } from './capture.js';
import { Navigation } from './navigation.js';
import * as indicator from './indicator.js';
import { log } from './logger.js';

const RECONNECT_TOKEN_KEY  = (sessionId) => `cobrowse_token_${sessionId}`;
const ACTIVE_SESSION_KEY   = 'cobrowse_active_session';
const SNAPSHOT_MAX_WAIT_MS = 30_000;

/**
 * Session module — orchestrates the full customer-side session lifecycle.
 *
 * State machine:
 *   idle → invited (invite received via Ably)
 *   invited → consenting (consent UI shown to customer)
 *   consenting → active (consent approved, capturing started)
 *   active → ended (session ended by any party)
 *
 * Also handles:
 *   - Reconnect on page refresh (sessionStorage token)
 *   - Cross-tab consent activation (localStorage event from consent page)
 */

class Session {
  constructor({ serverUrl, publicKey, customerId, onStateChange }) {
    this._serverUrl    = serverUrl;
    this._publicKey    = publicKey;
    this._customerId   = customerId;
    this._onStateChange = onStateChange || (() => {});

    this._state     = 'idle';
    this._sessionId = null;
    this._tenantId  = null;
    this._transport = null;
    this._capture   = null;
    this._navigation = null;
    this._maskingRules = null;

    // Ably client for the invite channel (pre-session)
    this._inviteAbly = null;

    // Polling fallback for detecting session end when Ably misses the event
    this._sessionEndPollTimer = null;
  }

  // ─── Initialise ──────────────────────────────────────────────────────────────

  async init(maskingRules) {
    this._maskingRules = maskingRules;
    await this._listenForInvites();
    await this._checkForPendingReconnect();
    this._listenForCrossTabConsent();
    this._pollForActivation();
  }

  // ─── Invite channel ───────────────────────────────────────────────────────────

  async _listenForInvites() {
    const Ably = window.Ably || (await import('ably'));
    const Client = Ably.Realtime || Ably.default?.Realtime;

    this._inviteAbly = new Client({
      authUrl:    `${this._serverUrl}/api/v1/ably-auth?role=invite&customerId=${this._customerId}`,
      authMethod: 'GET',
      authHeaders: { 'X-CB-Public-Key': this._publicKey },
      // No clientId — the server's TokenRequest sets it to 'customer:{customerId}'.
      // Specifying a different clientId here would cause Ably to reject the connection.
    });

    this._inviteAbly.connection.on('connected', () => {
      log.debug('[CoBrowse] Listening for invites');
    });

    // We don't know the tenantId yet — subscribe after receiving the first invite
    // The server sends tenantId in the invite payload
    this._inviteAbly.connection.once('connected', async () => {
      // Resolve tenantId from the public key
      const tenantId = await this._resolveTenantId();
      if (!tenantId) return;

      this._tenantId = tenantId;
      // [?rewind=1] replays the last published message on subscribe.
      // This ensures we catch invite/activate events published before the SDK
      // finished connecting — common when the page loads after the agent sends the invite.
      const ch = this._inviteAbly.channels.get(
        `[?rewind=1]invite:${tenantId}:${this._customerId}`
      );
      ch.subscribe('invite',   (msg) => this._handleInvite(msg.data));
      // Activation signal from server after consent on hosted consent page
      ch.subscribe('activate', (msg) => this._handleActivate(msg.data));
    });
  }

  async _resolveTenantId() {
    try {
      const res = await fetch(
        `${this._serverUrl}/api/v1/ably-auth?role=invite&customerId=${this._customerId}`,
        { headers: { 'X-CB-Public-Key': this._publicKey } }
      );
      const tokenRequest = await res.json();

      // Ably's capability field is a JSON-encoded string, not an object.
      // Parse it before extracting keys.
      let cap = tokenRequest.capability;
      if (typeof cap === 'string') {
        try { cap = JSON.parse(cap); } catch { cap = {}; }
      }

      const capKeys = Object.keys(cap || {});
      if (capKeys.length) {
        // channel name format: invite:{tenantId}:{customerId}
        const match = capKeys[0].match(/^invite:([^:]+):/);
        if (match) return match[1];
      }
    } catch (err) {
      log.warn('[CoBrowse] Could not resolve tenantId:', err.message);
    }
    return null;
  }

  _handleInvite(invite) {
    if (this._state !== 'idle') return; // already in a session

    this._sessionId = invite.sessionId;
    this._setState('invited');

    // Show consent overlay directly on the customer's page
    this._showConsentOverlay(invite);
  }

  // Called when the customer approved via the hosted consent page (cross-origin).
  // The server pushes the customerToken back on the invite channel so the SDK
  // activates without needing cross-origin localStorage access.
  _handleActivate({ sessionId, customerToken }) {
    if (this._state === 'active') return; // already active (e.g. inline consent used)

    log.debug('[CoBrowse] _handleActivate called', { hasSession: !!sessionId, hasToken: !!customerToken });

    // Remove inline overlay if it's still showing
    document.getElementById('__cobrowse_consent__')?.remove();

    this._sessionId = sessionId;

    // Extract tenantId from the customerToken.
    // The token is base64url-encoded: decode it first, then split by ':'.
    // Format after decode: sessionId:customerId:tenantId:expiresAt:hmac
    if (!this._tenantId && customerToken) {
      this._tenantId = this._extractTenantFromToken(customerToken);
      log.debug('[CoBrowse] resolved tenantId from token');
    }

    try {
      sessionStorage.setItem(`cobrowse_token_${sessionId}`, customerToken);
      sessionStorage.setItem('cobrowse_active_session', sessionId);
    } catch {}

    this._startCapture(customerToken).catch((err) => {
      log.error('[CoBrowse] _startCapture failed:', err);
      this._setState('idle');
    });
  }

  // ─── Consent overlay ──────────────────────────────────────────────────────────

  _showConsentOverlay({ agentId, inviteUrl }) {
    this._setState('consenting');

    const overlay = document.createElement('div');
    overlay.id = '__cobrowse_consent__';
    overlay.style.cssText = [
      'position: fixed', 'bottom: 24px', 'right: 24px',
      'background: #fff',
      'border-radius: 16px',
      'box-shadow: 0 8px 32px rgba(0,0,0,0.18)',
      'padding: 24px',
      'width: 320px',
      'z-index: 2147483645',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    ].join(';');

    overlay.innerHTML = `
      <div style="font-size:13px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
        Screen Sharing Request
      </div>
      <div style="font-size:15px;font-weight:700;color:#1a1a2e;margin-bottom:4px;">
        👤 Support Agent
      </div>
      <div style="font-size:13px;color:#666;margin-bottom:16px;line-height:1.5;">
        Your agent would like to view your screen to assist you.<br>
        Passwords and card numbers are always hidden.
      </div>
      <div style="display:flex;gap:10px;">
        <button id="__cb_decline__" style="flex:1;padding:10px;border-radius:8px;border:1px solid #e5e7eb;background:#f9fafb;font-size:14px;cursor:pointer;">
          Decline
        </button>
        <button id="__cb_allow__" style="flex:1;padding:10px;border-radius:8px;border:none;background:#4f6ef7;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">
          Allow
        </button>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('__cb_allow__').addEventListener('click', () => {
      overlay.remove();
      this._activate();
    });

    document.getElementById('__cb_decline__').addEventListener('click', () => {
      overlay.remove();
      this._decline();
    });
  }

  // ─── Activate session (after consent) ────────────────────────────────────────

  async _activate() {
    try {
      const res = await fetch(`${this._serverUrl}/consent/${this._sessionId}/approve`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ customerId: this._customerId }),
      });

      if (!res.ok) throw new Error(`Consent failed: ${res.status}`);

      const { customerToken } = await res.json();

      // Store token for reconnect across page refreshes
      try {
        sessionStorage.setItem(RECONNECT_TOKEN_KEY(this._sessionId), customerToken);
      } catch {}

      if (!this._tenantId) this._tenantId = this._extractTenantFromToken(customerToken);
      await this._startCapture(customerToken);
    } catch (err) {
      log.error('[CoBrowse] Activation failed:', err);
      this._setState('idle');
    }
  }

  async _decline() {
    try {
      await fetch(`${this._serverUrl}/consent/${this._sessionId}/decline`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ customerId: this._customerId }),
      });
    } catch {}
    this._sessionId = null;
    this._setState('idle');
  }

  // ─── Start capturing ──────────────────────────────────────────────────────────

  async _startCapture(customerToken) {
    // Guard against re-entrant calls (race between inline consent and Ably 'activate' event)
    if (this._state === 'active') {
      log.warn('[CoBrowse] _startCapture called while already active — ignoring');
      return;
    }
    log.debug('[CoBrowse] _startCapture: starting');
    this._setState('active'); // Set FIRST — prevents concurrent second call from proceeding

    // Create transport (not yet connected to Ably — events will be buffered until connection)
    this._transport = new Transport({
      serverUrl:     this._serverUrl,
      sessionId:     this._sessionId,
      customerToken,
      onCtrl: ({ type, x, y }) => {
        if (type === 'pointer') indicator.showPointer(x, y);
      },
      onSys: ({ type, reason }) => {
        if (type === 'session.ended') this._cleanup(reason || 'remote');
        if (type === 'session.idle_warned') {
          log.warn('[CoBrowse] Idle warning received — session will end soon');
        }
      },
    });

    // ── Start capture IMMEDIATELY — do NOT wait for Ably ──────────────────────
    // rrweb always emits synchronously: Meta (type 4) → FullSnapshot (type 2).
    // The rrweb Replayer needs BOTH events to render correctly:
    //   - Meta sets the iframe viewport dimensions
    //   - FullSnapshot reconstructs the DOM
    // We POST [meta, fullSnapshot] together via HTTP. All events are also buffered
    // for the Ably transport, which flushes them once connected.
    let metaEvent = null;
    let snapshotPosted = false;

    this._capture = new Capture({
      maskingRules: this._maskingRules,
      onEvent: (event) => {
        log.debug('[CoBrowse] rrweb event, type=', event && event.type);

        // Hold the Meta event (type 4) — needed by the replayer for viewport size
        if (event.type === 4 /* Meta */) {
          metaEvent = event;
        }

        // FullSnapshot ALWAYS goes via HTTP — never via Ably (initial or SPA navigation).
        // FullSnapshot can be 500 KB+, far exceeding Ably's 64 KB per-message limit.
        if (event.type === 2 /* FullSnapshot */) {
          const events = metaEvent ? [metaEvent, event] : [event];
          if (!snapshotPosted) {
            snapshotPosted = true;
            log.debug('[CoBrowse] posting initial snapshot, count=', events.length);
          } else {
            log.debug('[CoBrowse] re-posting snapshot on navigation, count=', events.length);
          }
          this._postSnapshot(events, customerToken);
          return; // Never enqueue FullSnapshot to Ably
        }

        // Skip the initial Meta event from Ably — it is bundled with the HTTP snapshot.
        // Post-navigation Meta events (snapshotPosted=true) flow via Ably so the
        // agent URL bar updates and the replayer gets the correct viewport size.
        if (event.type === 4 /* Meta */ && !snapshotPosted) {
          return;
        }

        // All other events (incremental DOM mutations, mouse, input, scroll…)
        // are streamed via Ably for live replay.
        this._transport.enqueue(event);
      },
    });

    log.debug('[CoBrowse] calling rrweb.record()...');
    this._capture.start();
    log.debug('[CoBrowse] rrweb.record() called. snapshotPosted=', snapshotPosted);

    // Start SPA navigation detection — triggers checkpoint snapshot + URL reporting
    this._navigation = new Navigation({
      onNavigate: (url) => {
        this._capture?.triggerCheckpoint();
        this._reportUrlChange(url);
      },
    });
    this._navigation.start();

    // Connect Ably transport in background (non-blocking)
    // Transport buffers events enqueued before connection; flushes them once attached.
    log.debug('[CoBrowse] connecting transport');
    this._transport.connect(this._tenantId)
      .then(() => log.debug('[CoBrowse] Transport connected'))
      .catch((err) => log.error('[CoBrowse] Transport connect failed:', err.message));

    // Inject the active session banner
    indicator.inject();
    indicator.onEndClick(() => this._endByCustomer());

    // Start polling fallback for session end detection
    this._pollForSessionEnd();
  }

  async _postSnapshot(snapshot, customerToken) {
    const url = `${this._serverUrl}/api/v1/snapshots/${this._sessionId}`;
    log.debug('[CoBrowse] _postSnapshot: POSTing to', url);
    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ snapshot, customerToken, url: location.href }),
      });
      log.debug('[CoBrowse] _postSnapshot: response status', res.status);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        log.warn('[CoBrowse] Snapshot upload failed with status', res.status, text);
      } else {
        log.info('[CoBrowse] Snapshot uploaded successfully');
      }
    } catch (err) {
      log.warn('[CoBrowse] Snapshot upload failed (network):', err.message);
    }
  }

  async _endByCustomer() {
    try {
      await fetch(`${this._serverUrl}/consent/${this._sessionId}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId: this._customerId }),
      });
    } catch {}
    this._cleanup('customer');
  }

  async _reportUrlChange(url) {
    // Fire-and-forget — navigation tracking is best-effort
    try {
      const token = sessionStorage.getItem(RECONNECT_TOKEN_KEY(this._sessionId));
      await fetch(`${this._serverUrl}/api/v1/snapshots/${this._sessionId}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ snapshot: {}, customerToken: token, url }),
      });
    } catch {}
  }

  // ─── Reconnect after page refresh ────────────────────────────────────────────

  async _checkForPendingReconnect() {
    try {
      const activeSessionId = sessionStorage.getItem(ACTIVE_SESSION_KEY);
      if (!activeSessionId) return;

      const token = sessionStorage.getItem(RECONNECT_TOKEN_KEY(activeSessionId));
      if (!token) return;

      // Verify session is still active with the server
      const res = await fetch(
        `${this._serverUrl}/consent/${activeSessionId}/approve`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ customerId: this._customerId }),
        }
      );

      if (res.ok) {
        const { customerToken } = await res.json();
        this._sessionId = activeSessionId;
        if (!this._tenantId) this._tenantId = this._extractTenantFromToken(customerToken);
        await this._startCapture(customerToken);
      } else {
        // Session ended while the customer was away
        sessionStorage.removeItem(RECONNECT_TOKEN_KEY(activeSessionId));
        sessionStorage.removeItem(ACTIVE_SESSION_KEY);
      }
    } catch {}
  }

  // ─── Polling fallback for activation ─────────────────────────────────────────
  // Ably 'activate' events can be missed if the SDK subscribes after the event
  // was published. This polls the server every 2 seconds as a reliable fallback.

  _pollForActivation() {
    const MAX_POLLS = 30; // reduced from 45 — backoff covers more time
    let attempts = 0;
    let interval = 2000; // start at 2s, grows with backoff

    const poll = async () => {
      if (this._state === 'active' || this._state === 'ended') return;
      if (++attempts > MAX_POLLS) return;

      try {
        const res = await fetch(
          `${this._serverUrl}/api/v1/public/pending-activation?customerId=${encodeURIComponent(this._customerId)}`,
          { headers: { 'X-CB-Public-Key': this._publicKey } }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.sessionId && this._state !== 'active') {
            if (data.status === 'pending' && this._state === 'idle') {
              // Pending invite — show consent overlay (fallback for missed Ably invite)
              this._handleInvite({
                sessionId: data.sessionId,
                agentId: data.agentId,
                inviteUrl: data.inviteUrl,
              });
              return; // stop polling — consent overlay is showing
            } else if (data.status === 'active' || data.customerToken) {
              this._handleActivate(data);
              return; // activated — stop polling
            }
          }
        }
      } catch { /* non-fatal */ }

      // Exponential backoff: 2s → 3s → 4.5s → ... capped at 15s
      interval = Math.min(interval * 1.5, 15000);
      setTimeout(poll, interval);
    };

    setTimeout(poll, 2000); // first check 2 seconds after init
  }

  // ─── Polling fallback for session end ──────────────────────────────────────────
  // Ably 'session.ended' events can be missed if the transport connects after the
  // event was published and rewind doesn't fire (e.g. Brave shields block WebSocket).
  // This polls the server as a reliable fallback to detect session end.

  _pollForSessionEnd() {
    let interval = 5000; // start at 5s, grows with backoff

    const poll = async () => {
      if (this._state !== 'active') return; // already cleaned up

      try {
        const res = await fetch(
          `${this._serverUrl}/api/v1/public/pending-activation?customerId=${encodeURIComponent(this._customerId)}`,
          { headers: { 'X-CB-Public-Key': this._publicKey } }
        );
        if (res.ok) {
          const data = await res.json();
          // If no session found or a different session is active, our session ended
          if (!data.sessionId || data.sessionId !== this._sessionId) {
            log.info('[CoBrowse] Session end detected via polling');
            this._cleanup('remote');
            return;
          }
        }
      } catch { /* non-fatal — will retry next interval */ }

      if (this._state !== 'active') return; // check again after async work

      // Exponential backoff: 5s → 7.5s → 11.25s → ... capped at 30s
      interval = Math.min(interval * 1.5, 30000);
      this._sessionEndPollTimer = setTimeout(poll, interval);
    };

    this._sessionEndPollTimer = setTimeout(poll, 5000); // first check 5s after capture starts
  }

  // ─── Cross-tab consent (customer consents on the Sprinklr-hosted page) ────────

  _listenForCrossTabConsent() {
    window.addEventListener('storage', (e) => {
      if (!e.key?.startsWith('cobrowse_token_')) return;
      const sessionId = e.key.replace('cobrowse_token_', '');
      const token = e.newValue;
      if (!token || this._state !== 'idle') return;

      this._sessionId = sessionId;
      if (!this._tenantId) this._tenantId = this._extractTenantFromToken(token);
      sessionStorage.setItem(RECONNECT_TOKEN_KEY(sessionId), token);
      sessionStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
      this._startCapture(token);
    });
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────────

  _cleanup(reason) {
    if (this._state === 'idle') return; // already cleaned up (Ably + poll race)
    if (this._sessionEndPollTimer) {
      clearTimeout(this._sessionEndPollTimer);
      this._sessionEndPollTimer = null;
    }
    this._navigation?.stop();
    this._navigation = null;
    this._capture?.stop();
    this._transport?.disconnect();
    indicator.remove();
    try {
      sessionStorage.removeItem(RECONNECT_TOKEN_KEY(this._sessionId));
      sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    } catch {}
    this._sessionId = null;
    this._capture   = null;
    this._transport = null;
    this._setState('idle');
    log.info(`[CoBrowse] Session ended. Reason: ${reason}`);
  }

  _setState(state) {
    this._state = state;
    this._onStateChange(state);
  }

  /**
   * Decode the base64url customer token and return the tenantId (3rd field).
   * Token format after decode: sessionId:customerId:tenantId:expiresAt:hmac
   */
  _extractTenantFromToken(token) {
    try {
      // base64url → standard base64 (pad + replace chars)
      const pad = (4 - (token.length % 4)) % 4;
      const b64 = token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
      const decoded = atob(b64);
      const parts = decoded.split(':');
      return parts.length >= 3 ? parts[2] : null;
    } catch {
      return null;
    }
  }
}

export { Session };
