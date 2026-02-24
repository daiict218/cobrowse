/**
 * CoBrowse Agent SDK
 *
 * Thin library for vendor integration. Handles session creation,
 * opens the embed viewer in a new window, and provides event callbacks.
 *
 * Usage:
 *   const agent = CoBrowseAgent.init({ serverUrl, jwt });
 *   const session = await agent.createSession('customer_123');
 *   agent.openViewer(session.sessionId);
 *   await agent.endSession(session.sessionId);
 *   agent.destroy();
 */

class AgentSDK {
  constructor({ serverUrl, jwt, secretKey }) {
    if (!serverUrl) throw new Error('CoBrowseAgent.init: serverUrl is required');
    if (!jwt && !secretKey) throw new Error('CoBrowseAgent.init: jwt or secretKey is required');

    this._serverUrl = serverUrl.replace(/\/$/, '');
    this._jwt = jwt || null;
    this._secretKey = secretKey || null;
    this._listeners = {};
    this._viewerWindows = new Map(); // sessionId → window
    this._windowPollInterval = null;

    // Listen for postMessage from viewer windows
    this._onMessage = (e) => this._handleMessage(e);
    if (typeof window !== 'undefined') {
      window.addEventListener('message', this._onMessage);
    }
  }

  // ─── API helper ──────────────────────────────────────────────────────────
  async _api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };

    if (this._jwt) {
      headers['Authorization'] = `Bearer ${this._jwt}`;
    } else if (this._secretKey) {
      headers['X-API-Key'] = this._secretKey;
    }

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(`${this._serverUrl}${path}`, options);
    if (res.status === 204) return {};

    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  }

  // ─── Session management ──────────────────────────────────────────────────
  async createSession(customerId, options = {}) {
    const body = { customerId };
    if (options.agentId) body.agentId = options.agentId;
    if (options.channelRef) body.channelRef = options.channelRef;

    const result = await this._api('POST', '/api/v1/sessions', body);
    this._emit('session.created', result);
    return result;
  }

  async getSession(sessionId) {
    return this._api('GET', `/api/v1/sessions/${sessionId}`);
  }

  async endSession(sessionId) {
    await this._api('DELETE', `/api/v1/sessions/${sessionId}`);

    // Close viewer window if open
    const win = this._viewerWindows.get(sessionId);
    if (win && !win.closed) {
      win.close();
    }
    this._viewerWindows.delete(sessionId);

    this._emit('session.ended', { sessionId });
  }

  // ─── Viewer management ────────────────────────────────────────────────────
  openViewer(sessionId) {
    if (!sessionId) throw new Error('sessionId is required');

    const token = this._jwt || '';
    const url = `${this._serverUrl}/embed/session/${sessionId}?token=${encodeURIComponent(token)}`;

    // Open in a new browser window (not tab)
    const features = 'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no';
    const win = window.open(url, `cobrowse_viewer_${sessionId}`, features);

    if (win) {
      this._viewerWindows.set(sessionId, win);
      this._startWindowPolling();
      this._emit('viewer.opened', { sessionId });
    }

    return win;
  }

  // Poll for viewer window.closed to detect manual close
  _startWindowPolling() {
    if (this._windowPollInterval) return;

    this._windowPollInterval = setInterval(() => {
      for (const [sessionId, win] of this._viewerWindows) {
        if (win.closed) {
          this._viewerWindows.delete(sessionId);
          this._emit('viewer.closed', { sessionId });
        }
      }

      if (this._viewerWindows.size === 0) {
        clearInterval(this._windowPollInterval);
        this._windowPollInterval = null;
      }
    }, 500);
  }

  // ─── postMessage handling from viewer ──────────────────────────────────────
  _handleMessage(event) {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'session.stateChange') {
      this._emit('session.stateChange', data);
    } else if (data.type === 'session.urlChanged') {
      this._emit('session.urlChanged', data);
    }
  }

  // ─── Event emitter ────────────────────────────────────────────────────────
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return this;
  }

  off(event, callback) {
    if (!this._listeners[event]) return this;
    this._listeners[event] = this._listeners[event].filter((cb) => cb !== callback);
    return this;
  }

  _emit(event, data) {
    const cbs = this._listeners[event];
    if (cbs) {
      for (const cb of cbs) {
        try { cb(data); } catch { /* listener error — non-fatal */ }
      }
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  destroy() {
    // Close all viewer windows
    for (const [, win] of this._viewerWindows) {
      if (win && !win.closed) win.close();
    }
    this._viewerWindows.clear();

    clearInterval(this._windowPollInterval);
    this._windowPollInterval = null;

    if (typeof window !== 'undefined') {
      window.removeEventListener('message', this._onMessage);
    }

    this._listeners = {};
  }
}

// Static factory
function init(options) {
  return new AgentSDK(options);
}

export default { init };
