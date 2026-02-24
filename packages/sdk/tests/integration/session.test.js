/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Session } from '../../src/session.js';
import { createTestToken, createMockAblyRealtime } from './helpers/browser-env.js';

describe('Session', () => {
  let mockFetch;
  let MockRealtime;
  let session;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Mock fetch with pattern matching
    mockFetch = vi.fn(async (url) => {
      if (url.includes('/api/v1/ably-auth')) {
        return {
          ok: true,
          json: async () => ({
            keyName: 'test.key',
            timestamp: Date.now(),
            nonce: 'nonce',
            capability: JSON.stringify({ 'invite:tenant1:cust_1': ['subscribe'] }),
          }),
        };
      }
      if (url.includes('/consent/') && url.includes('/approve')) {
        return {
          ok: true,
          json: async () => ({
            approved: true,
            customerToken: createTestToken('sess1', 'cust_1', 'tenant1'),
            sessionId: 'sess1',
          }),
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
      return { ok: true, json: async () => ({}) };
    });
    globalThis.fetch = mockFetch;

    // Mock sessionStorage
    const store = new Map();
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => store.get(key) ?? null),
        setItem: vi.fn((key, value) => store.set(key, value)),
        removeItem: vi.fn((key) => store.delete(key)),
        clear: vi.fn(() => store.clear()),
      },
      writable: true,
      configurable: true,
    });

    // Mock Ably
    MockRealtime = createMockAblyRealtime();
    globalThis.window.Ably = { Realtime: MockRealtime };

    // Mock rrweb
    const stopFn = vi.fn();
    globalThis.window.rrweb = {
      record: vi.fn((config) => {
        if (config.emit) {
          config.emit({ type: 4, data: { href: 'http://localhost' } });
          config.emit({ type: 2, data: { node: {} } });
        }
        return stopFn;
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    if (session) {
      session._cleanup('test');
      session = null;
    }
  });

  it('starts in idle state', () => {
    session = new Session({
      serverUrl: 'http://localhost:3000',
      publicKey: 'cb_pk_test',
      customerId: 'cust_1',
    });
    expect(session._state).toBe('idle');
  });

  describe('_extractTenantFromToken', () => {
    it('extracts tenantId from a valid token', () => {
      session = new Session({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });
      const token = createTestToken('sess1', 'cust_1', 'my-tenant-id');
      const tenantId = session._extractTenantFromToken(token);
      expect(tenantId).toBe('my-tenant-id');
    });

    it('returns null for invalid token', () => {
      session = new Session({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });
      expect(session._extractTenantFromToken('not-a-token')).toBeNull();
    });
  });

  describe('_handleInvite', () => {
    it('transitions from idle to invited', () => {
      session = new Session({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
        onStateChange: vi.fn(),
      });
      session._handleInvite({ sessionId: 'sess1', agentId: 'agent1', inviteUrl: 'http://localhost/consent/sess1' });
      expect(session._state).toBe('consenting');
      expect(session._sessionId).toBe('sess1');
    });

    it('ignores invite when not idle', () => {
      session = new Session({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
        onStateChange: vi.fn(),
      });
      session._state = 'active';
      session._handleInvite({ sessionId: 'sess2', agentId: 'agent1' });
      expect(session._sessionId).toBeNull(); // unchanged
    });
  });

  describe('_handleActivate', () => {
    it('skips if already active', () => {
      session = new Session({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
        onStateChange: vi.fn(),
      });
      session._state = 'active';
      const spy = vi.spyOn(session, '_startCapture');
      session._handleActivate({ sessionId: 'sess1', customerToken: createTestToken() });
      expect(spy).not.toHaveBeenCalled();
    });

    it('sets sessionId and starts capture', async () => {
      session = new Session({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
        onStateChange: vi.fn(),
      });
      session._tenantId = 'tenant1';
      session._maskingRules = {};
      session._handleActivate({
        sessionId: 'sess1',
        customerToken: createTestToken('sess1', 'cust_1', 'tenant1'),
      });

      // Wait for async _startCapture
      await vi.advanceTimersByTimeAsync(100);

      expect(session._sessionId).toBe('sess1');
      expect(session._state).toBe('active');
    });
  });

  describe('_decline', () => {
    it('resets state to idle', async () => {
      session = new Session({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
        onStateChange: vi.fn(),
      });
      session._sessionId = 'sess1';
      session._state = 'consenting';

      await session._decline();

      expect(session._state).toBe('idle');
      expect(session._sessionId).toBeNull();
    });
  });

  describe('_cleanup', () => {
    it('stops capture and transport, resets state', () => {
      session = new Session({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
        onStateChange: vi.fn(),
      });
      session._sessionId = 'sess1';
      session._capture = { stop: vi.fn() };
      session._transport = { disconnect: vi.fn() };
      session._state = 'active';

      session._cleanup('test');

      expect(session._capture).toBeNull();
      expect(session._transport).toBeNull();
      expect(session._state).toBe('idle');
    });
  });

  describe('_setState', () => {
    it('updates state and calls callback', () => {
      const onChange = vi.fn();
      session = new Session({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
        onStateChange: onChange,
      });
      session._setState('active');
      expect(session._state).toBe('active');
      expect(onChange).toHaveBeenCalledWith('active');
    });
  });

  describe('_pollForActivation', () => {
    it('polls server for pending sessions', async () => {
      session = new Session({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
        onStateChange: vi.fn(),
      });

      session._pollForActivation();

      // Advance timer to trigger first poll
      await vi.advanceTimersByTimeAsync(2500);

      const pollCalls = mockFetch.mock.calls.filter(
        ([url]) => url.includes('/pending-activation')
      );
      expect(pollCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('stops polling when state becomes active', async () => {
      session = new Session({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
        onStateChange: vi.fn(),
      });

      session._state = 'active';
      session._pollForActivation();

      await vi.advanceTimersByTimeAsync(5000);

      const pollCalls = mockFetch.mock.calls.filter(
        ([url]) => url.includes('/pending-activation')
      );
      expect(pollCalls.length).toBe(0);
    });
  });
});
