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

import { log } from './logger.js';

const ABLY_BATCH_INTERVAL_MS = 80;   // Ably flush every 80ms (≈12 batches/sec)
const ABLY_MAX_BATCH_SIZE    = 50;   // max events per Ably message
const HTTP_FLUSH_INTERVAL_MS = 80;   // HTTP relay flush — fast enough for low-latency, stays under rate limit
const MAX_QUEUE_SIZE         = 10000; // prevent unbounded memory growth

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
      log.warn('[CoBrowse] Ably connection failed, HTTP relay is active:', err.message);
      // HTTP relay is already running — events will still reach the server
    }
  }

  async _connectAbly(tenantId) {
    const Ably = window.Ably || (await import('ably'));
    const Client = Ably.Realtime || Ably.default?.Realtime;

    log.debug('[CoBrowse] Transport: connecting to Ably…');

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

    log.debug('[CoBrowse] Transport: Ably connected');

    // Channels are keyed by tenantId to prevent cross-tenant access
    this._domCh  = this._ably.channels.get(`session:${tenantId}:${this._sessionId}:dom`);
    this._ctrlCh = this._ably.channels.get(`session:${tenantId}:${this._sessionId}:ctrl`);
    this._sysCh  = this._ably.channels.get(`session:${tenantId}:${this._sessionId}:sys`);

    // Agent pointer events — validate bounds before using
    this._ctrlCh.subscribe('pointer', (msg) => {
      const data = msg.data;
      if (!data || typeof data !== 'object') return;
      const { x, y } = data;
      if (typeof x !== 'number' || typeof y !== 'number') return;
      if (!isFinite(x) || !isFinite(y)) return;
      // Clamp to valid viewport range (0–1 normalised)
      this._onCtrl({ type: 'pointer', x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
    });

    // System lifecycle events — whitelist valid event types
    const VALID_SYS_EVENTS = new Set(['session.ended', 'session.idle_warned', 'snapshot.updated', 'customer.joined']);
    this._sysCh.subscribe((msg) => {
      if (!VALID_SYS_EVENTS.has(msg.name)) return;
      const data = (msg.data && typeof msg.data === 'object') ? msg.data : {};
      this._onSys({ type: msg.name, ...data });
    });

    this._ablyReady = true;
    this._startAblyBatchTimer();
  }

  /**
   * Queue a DOM event for transmission via both channels.
   */
  enqueue(event) {
    this._ablyBatch.push(event);
    this._httpBatch.push(event);

    // Prevent unbounded memory growth — drop oldest events if queue overflows
    if (this._ablyBatch.length > MAX_QUEUE_SIZE) {
      this._ablyBatch.splice(0, Math.floor(MAX_QUEUE_SIZE * 0.1));
    }
    if (this._httpBatch.length > MAX_QUEUE_SIZE) {
      this._httpBatch.splice(0, Math.floor(MAX_QUEUE_SIZE * 0.1));
    }

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
      log.warn('[CoBrowse] Ably publish failed, will retry:', err.message);
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
