/**
 * Browser environment mocks for SDK integration tests.
 *
 * Sets up mock fetch, sessionStorage, Ably, rrweb, and other browser globals
 * needed by the SDK modules when running under jsdom.
 */
import { vi } from 'vitest';

/**
 * Create a mock fetch that responds based on URL patterns.
 */
function createMockFetch(overrides = {}) {
  return vi.fn(async (url, opts) => {
    // Default responses
    if (url.includes('/api/v1/public/masking-rules')) {
      return {
        ok: true,
        json: async () => ({ maskingRules: { selectors: [], maskTypes: ['password'], patterns: [] } }),
      };
    }

    if (url.includes('/api/v1/ably-auth')) {
      return {
        ok: true,
        json: async () => ({
          keyName: 'test.key',
          timestamp: Date.now(),
          nonce: 'nonce',
          capability: JSON.stringify({ 'invite:tenant1:cust1': ['subscribe'] }),
          mac: 'mac',
        }),
      };
    }

    if (url.includes('/consent/') && url.includes('/approve')) {
      return {
        ok: true,
        json: async () => ({ approved: true, customerToken: createTestToken(), sessionId: 'test-session-id' }),
      };
    }

    if (url.includes('/consent/') && url.includes('/decline')) {
      return { ok: true, json: async () => ({ declined: true }) };
    }

    if (url.includes('/api/v1/snapshots/')) {
      return { ok: true, json: async () => ({ stored: true }), text: async () => '' };
    }

    if (url.includes('/api/v1/dom-events/')) {
      return { ok: true, json: async () => ({ buffered: 0 }) };
    }

    if (url.includes('/api/v1/public/pending-activation')) {
      return { ok: true, json: async () => ({ sessionId: null }) };
    }

    // Custom overrides
    if (overrides.handler) {
      return overrides.handler(url, opts);
    }

    return { ok: true, json: async () => ({}), text: async () => '' };
  });
}

/**
 * Create a mock sessionStorage backed by a Map.
 */
function createMockSessionStorage() {
  const store = new Map();
  return {
    getItem: vi.fn((key) => store.get(key) ?? null),
    setItem: vi.fn((key, value) => store.set(key, value)),
    removeItem: vi.fn((key) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    _store: store,
  };
}

/**
 * Create a mock Ably Realtime client.
 */
function createMockAblyRealtime() {
  const subscriptions = {};
  const connectionCallbacks = {};

  return class MockRealtime {
    constructor() {
      this.connection = {
        on: vi.fn((event, cb) => {
          connectionCallbacks[event] = connectionCallbacks[event] || [];
          connectionCallbacks[event].push(cb);
        }),
        once: vi.fn((event, cb) => {
          connectionCallbacks[event] = connectionCallbacks[event] || [];
          connectionCallbacks[event].push(cb);
          // Auto-connect after a tick
          if (event === 'connected') {
            setTimeout(() => cb(), 0);
          }
        }),
        close: vi.fn(),
      };

      this.channels = {
        get: vi.fn((name) => ({
          subscribe: vi.fn((eventOrCb, maybeCb) => {
            const event = typeof eventOrCb === 'string' ? eventOrCb : '*';
            const cb = maybeCb || eventOrCb;
            subscriptions[`${name}:${event}`] = cb;
          }),
          publish: vi.fn().mockResolvedValue(undefined),
          name,
        })),
      };

      // Emit connected immediately
      this._connectionCallbacks = connectionCallbacks;
      this._subscriptions = subscriptions;
    }
  };
}

/**
 * Create a mock rrweb.
 */
function createMockRrweb() {
  const stopFn = vi.fn();
  return {
    record: vi.fn((config) => {
      // Emit meta + full snapshot synchronously like real rrweb
      if (config.emit) {
        config.emit({ type: 4, data: { href: 'http://localhost', width: 1920, height: 1080 } });
        config.emit({ type: 2, data: { node: { type: 0, childNodes: [] } } });
      }
      return stopFn;
    }),
    _stopFn: stopFn,
  };
}

/**
 * Create a test customer token (base64url encoded).
 */
function createTestToken(sessionId = 'test-session-id', customerId = 'cust_1', tenantId = 'tenant_1') {
  const expiresAt = Date.now() + 7_200_000;
  const payload = `${sessionId}:${customerId}:${tenantId}:${expiresAt}:fakehmacsignature`;
  return Buffer.from(payload).toString('base64url');
}

/**
 * Set up all browser globals for SDK testing.
 */
function setupBrowserEnv() {
  const mockFetch = createMockFetch();
  const mockSessionStorage = createMockSessionStorage();
  const MockRealtime = createMockAblyRealtime();
  const mockRrweb = createMockRrweb();

  globalThis.fetch = mockFetch;
  Object.defineProperty(globalThis, 'sessionStorage', { value: mockSessionStorage, writable: true });
  globalThis.window = globalThis.window || globalThis;
  globalThis.window.Ably = { Realtime: MockRealtime };
  globalThis.window.rrweb = mockRrweb;
  globalThis.location = globalThis.location || { href: 'http://localhost:3001/page' };
  globalThis.atob = (str) => Buffer.from(str, 'base64').toString('utf8');

  return { mockFetch, mockSessionStorage, MockRealtime, mockRrweb };
}

export {
  createMockFetch,
  createMockSessionStorage,
  createMockAblyRealtime,
  createMockRrweb,
  createTestToken,
  setupBrowserEnv,
};
