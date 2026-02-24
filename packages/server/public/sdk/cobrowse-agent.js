var CoBrowseAgent = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.js
  var src_exports = {};
  __export(src_exports, {
    default: () => src_default
  });
  var AgentSDK = class {
    constructor({ serverUrl, jwt, secretKey }) {
      if (!serverUrl)
        throw new Error("CoBrowseAgent.init: serverUrl is required");
      if (!jwt && !secretKey)
        throw new Error("CoBrowseAgent.init: jwt or secretKey is required");
      this._serverUrl = serverUrl.replace(/\/$/, "");
      this._jwt = jwt || null;
      this._secretKey = secretKey || null;
      this._listeners = {};
      this._viewerWindows = /* @__PURE__ */ new Map();
      this._windowPollInterval = null;
      this._onMessage = (e) => this._handleMessage(e);
      if (typeof window !== "undefined") {
        window.addEventListener("message", this._onMessage);
      }
    }
    // ─── API helper ──────────────────────────────────────────────────────────
    async _api(method, path, body) {
      const headers = { "Content-Type": "application/json" };
      if (this._jwt) {
        headers["Authorization"] = `Bearer ${this._jwt}`;
      } else if (this._secretKey) {
        headers["X-API-Key"] = this._secretKey;
      }
      const options = { method, headers };
      if (body)
        options.body = JSON.stringify(body);
      const res = await fetch(`${this._serverUrl}${path}`, options);
      if (res.status === 204)
        return {};
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.message || `HTTP ${res.status}`);
      return data;
    }
    // ─── Session management ──────────────────────────────────────────────────
    async createSession(customerId, options = {}) {
      const body = { customerId };
      if (options.agentId)
        body.agentId = options.agentId;
      if (options.channelRef)
        body.channelRef = options.channelRef;
      const result = await this._api("POST", "/api/v1/sessions", body);
      this._emit("session.created", result);
      return result;
    }
    async getSession(sessionId) {
      return this._api("GET", `/api/v1/sessions/${sessionId}`);
    }
    async endSession(sessionId) {
      await this._api("DELETE", `/api/v1/sessions/${sessionId}`);
      const win = this._viewerWindows.get(sessionId);
      if (win && !win.closed) {
        win.close();
      }
      this._viewerWindows.delete(sessionId);
      this._emit("session.ended", { sessionId });
    }
    // ─── Viewer management ────────────────────────────────────────────────────
    openViewer(sessionId) {
      if (!sessionId)
        throw new Error("sessionId is required");
      const token = this._jwt || "";
      const url = `${this._serverUrl}/embed/session/${sessionId}?token=${encodeURIComponent(token)}`;
      const features = "width=1024,height=768,menubar=no,toolbar=no,location=no,status=no";
      const win = window.open(url, `cobrowse_viewer_${sessionId}`, features);
      if (win) {
        this._viewerWindows.set(sessionId, win);
        this._startWindowPolling();
        this._emit("viewer.opened", { sessionId });
      }
      return win;
    }
    // Poll for viewer window.closed to detect manual close
    _startWindowPolling() {
      if (this._windowPollInterval)
        return;
      this._windowPollInterval = setInterval(() => {
        for (const [sessionId, win] of this._viewerWindows) {
          if (win.closed) {
            this._viewerWindows.delete(sessionId);
            this._emit("viewer.closed", { sessionId });
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
      if (!data || typeof data !== "object")
        return;
      if (data.type === "session.stateChange") {
        this._emit("session.stateChange", data);
      } else if (data.type === "session.urlChanged") {
        this._emit("session.urlChanged", data);
      }
    }
    // ─── Event emitter ────────────────────────────────────────────────────────
    on(event, callback) {
      if (!this._listeners[event])
        this._listeners[event] = [];
      this._listeners[event].push(callback);
      return this;
    }
    off(event, callback) {
      if (!this._listeners[event])
        return this;
      this._listeners[event] = this._listeners[event].filter((cb) => cb !== callback);
      return this;
    }
    _emit(event, data) {
      const cbs = this._listeners[event];
      if (cbs) {
        for (const cb of cbs) {
          try {
            cb(data);
          } catch {
          }
        }
      }
    }
    // ─── Cleanup ──────────────────────────────────────────────────────────────
    destroy() {
      for (const [, win] of this._viewerWindows) {
        if (win && !win.closed)
          win.close();
      }
      this._viewerWindows.clear();
      clearInterval(this._windowPollInterval);
      this._windowPollInterval = null;
      if (typeof window !== "undefined") {
        window.removeEventListener("message", this._onMessage);
      }
      this._listeners = {};
    }
  };
  function init(options) {
    return new AgentSDK(options);
  }
  var src_default = { init };
  return __toCommonJS(src_exports);
})();
CoBrowseAgent = CoBrowseAgent && CoBrowseAgent.default ? CoBrowseAgent.default : CoBrowseAgent;
if (typeof module !== "undefined") module.exports = CoBrowseAgent;
//# sourceMappingURL=cobrowse-agent.js.map
