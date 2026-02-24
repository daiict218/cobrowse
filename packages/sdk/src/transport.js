'use strict';

/**
 * Transport module — manages the Ably WebSocket connection for the customer SDK.
 *
 * Responsibilities:
 *   - Request scoped Ably tokens from the session server (never exposes master key)
 *   - Publish batched rrweb events to the :dom channel
 *   - Subscribe to :ctrl (agent pointer) and :sys (lifecycle) channels
 *   - Automatic reconnect with exponential backoff
 */

const BATCH_INTERVAL_MS = 80;  // flush events every 80ms (≈12 batches/sec)
const MAX_BATCH_SIZE    = 50;  // max events per batch to stay under Ably message limits

class Transport {
  constructor({ serverUrl, sessionId, customerToken, onCtrl, onSys }) {
    this._serverUrl    = serverUrl;
    this._sessionId    = sessionId;
    this._customerToken = customerToken;

    this._onCtrl = onCtrl || (() => {});
    this._onSys  = onSys  || (() => {});

    this._ably     = null;
    this._domCh    = null;
    this._ctrlCh   = null;
    this._sysCh    = null;

    this._batch    = [];
    this._timer    = null;
    this._connected = false;
  }

  async connect(tenantId) {
    const Ably = window.Ably || (await import('ably'));
    const Client = Ably.Realtime || Ably.default?.Realtime;

    console.debug('[CoBrowse] Transport: connecting to Ably, sessionId=', this._sessionId, 'tenantId=', tenantId);

    this._ably = new Client({
      authUrl:    `${this._serverUrl}/api/v1/ably-auth?role=customer&sessionId=${this._sessionId}`,
      authMethod: 'GET',
      authHeaders: { 'X-Customer-Token': this._customerToken },
      // No clientId here — the server's TokenRequest sets it to 'customer:{customerId}'.
      // Specifying a different clientId here would cause Ably to reject the connection.
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Ably connection timed out after 15 seconds'));
      }, 15_000);

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

    this._connected = true;
    this._startBatchTimer();
  }

  /**
   * Queue a DOM event for batched transmission.
   * Events are buffered and sent every BATCH_INTERVAL_MS to reduce message count.
   */
  enqueue(event) {
    // Always buffer — even before Ably connects. Meta + FullSnapshot events are
    // emitted synchronously by rrweb.record() before the async connect() resolves,
    // so we must NOT drop them. _flush() safely no-ops when _domCh is null.
    this._batch.push(event);
    if (this._connected && this._batch.length >= MAX_BATCH_SIZE) {
      this._flush();
    }
  }

  _startBatchTimer() {
    this._timer = setInterval(() => this._flush(), BATCH_INTERVAL_MS);
  }

  async _flush() {
    if (!this._batch.length || !this._domCh) return;
    const events = this._batch.splice(0, this._batch.length);
    try {
      await this._domCh.publish('events', events);
    } catch (err) {
      // Re-queue dropped events on publish failure
      this._batch.unshift(...events);
      console.warn('[CoBrowse] Failed to publish events, will retry:', err.message);
    }
  }

  disconnect() {
    this._connected = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._flush(); // drain remaining events
    this._ably?.connection.close();
  }
}

module.exports = { Transport };
