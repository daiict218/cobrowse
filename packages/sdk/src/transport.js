/**
 * Transport module — manages event delivery for the customer SDK.
 *
 * Dual-channel architecture:
 *   1. Ably WebSocket (primary) — low-latency real-time events
 *   2. HTTP relay (always-on)   — reliable fallback when WebSocket is blocked
 *
 * The HTTP relay starts IMMEDIATELY on connect(), before waiting for Ably.
 * This ensures events flow to the server within ~100ms regardless of whether
 * Ably connects or not. The agent polls the HTTP relay for events.
 */

const ABLY_BATCH_INTERVAL_MS = 80;   // Ably flush every 80ms (≈12 batches/sec)
const ABLY_MAX_BATCH_SIZE    = 50;   // max events per Ably message
const HTTP_FLUSH_INTERVAL_MS = 100;  // HTTP relay flush every 100ms

class Transport {
  constructor({ serverUrl, sessionId, customerToken, onCtrl, onSys }) {
    this._serverUrl     = serverUrl;
    this._sessionId     = sessionId;
    this._customerToken = customerToken;

    this._onCtrl = onCtrl || (() => {});
    this._onSys  = onSys  || (() => {});

    this._ably     = null;
    this._domCh    = null;
    this._ctrlCh   = null;
    this._sysCh    = null;

    // Ably batch buffer
    this._ablyBatch   = [];
    this._ablyTimer   = null;
    this._ablyReady   = false;

    // HTTP relay buffer — starts immediately, doesn't wait for Ably
    this._httpBatch   = [];
    this._httpTimer   = null;
  }

  async connect(tenantId) {
    // ── Start HTTP relay IMMEDIATELY — no waiting for Ably ──────────────────
    this._startHttpRelay();

    // ── Connect Ably in parallel (non-blocking for HTTP relay) ──────────────
    try {
      await this._connectAbly(tenantId);
    } catch (err) {
      console.warn('[CoBrowse] Ably connection failed, HTTP relay is active:', err.message);
      // HTTP relay is already running — events will still reach the server
    }
  }

  async _connectAbly(tenantId) {
    const Ably = window.Ably || (await import('ably'));
    const Client = Ably.Realtime || Ably.default?.Realtime;

    console.debug('[CoBrowse] Transport: connecting to Ably…');

    this._ably = new Client({
      authUrl:    `${this._serverUrl}/api/v1/ably-auth?role=customer&sessionId=${this._sessionId}`,
      authMethod: 'GET',
      authHeaders: { 'X-Customer-Token': this._customerToken },
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Ably connection timed out after 10 seconds'));
      }, 10_000);

      this._ably.connection.once('connected', () => { clearTimeout(timeout); resolve(); });
      this._ably.connection.once('failed',    (err) => { clearTimeout(timeout); reject(err); });
    });

    console.debug('[CoBrowse] Transport: Ably connected');

    // Channels are keyed by tenantId to prevent cross-tenant access
    this._domCh  = this._ably.channels.get(`session:${tenantId}:${this._sessionId}:dom`);
    this._ctrlCh = this._ably.channels.get(`session:${tenantId}:${this._sessionId}:ctrl`);
    this._sysCh  = this._ably.channels.get(`session:${tenantId}:${this._sessionId}:sys`);

    // Agent pointer events
    this._ctrlCh.subscribe('pointer', (msg) => this._onCtrl({ type: 'pointer', ...msg.data }));

    // System lifecycle events (session end, idle warning)
    this._sysCh.subscribe((msg) => this._onSys({ type: msg.name, ...msg.data }));

    this._ablyReady = true;
    this._startAblyBatchTimer();
  }

  /**
   * Queue a DOM event for transmission via both channels.
   */
  enqueue(event) {
    this._ablyBatch.push(event);
    this._httpBatch.push(event);

    if (this._ablyReady && this._ablyBatch.length >= ABLY_MAX_BATCH_SIZE) {
      this._flushAbly();
    }
  }

  // ─── Ably batch flush ──────────────────────────────────────────────────────

  _startAblyBatchTimer() {
    this._ablyTimer = setInterval(() => this._flushAbly(), ABLY_BATCH_INTERVAL_MS);
  }

  async _flushAbly() {
    if (!this._ablyBatch.length || !this._domCh) return;
    const events = this._ablyBatch.splice(0, this._ablyBatch.length);
    try {
      await this._domCh.publish('events', events);
    } catch (err) {
      this._ablyBatch.unshift(...events);
      console.warn('[CoBrowse] Ably publish failed, will retry:', err.message);
    }
  }

  // ─── HTTP relay (always-on, starts before Ably) ────────────────────────────

  _startHttpRelay() {
    if (this._httpTimer) return; // already running
    this._httpTimer = setInterval(() => this._flushHttp(), HTTP_FLUSH_INTERVAL_MS);
  }

  async _flushHttp() {
    if (!this._httpBatch.length) return;
    const events = this._httpBatch.splice(0, this._httpBatch.length);
    try {
      await fetch(`${this._serverUrl}/api/v1/dom-events/${this._sessionId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Customer-Token': this._customerToken,
        },
        body: JSON.stringify({ events, customerToken: this._customerToken }),
      });
    } catch {
      // Re-queue on failure — will retry next interval
      this._httpBatch.unshift(...events);
    }
  }

  disconnect() {
    this._ablyReady = false;
    if (this._ablyTimer) { clearInterval(this._ablyTimer); this._ablyTimer = null; }
    if (this._httpTimer) { clearInterval(this._httpTimer); this._httpTimer = null; }
    this._flushAbly();
    this._flushHttp();
    this._ably?.connection.close();
  }
}

export { Transport };
