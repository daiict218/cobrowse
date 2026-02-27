/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger
vi.mock('../../src/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock transport
vi.mock('../../src/transport.js', () => ({
  Transport: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

// Mock capture
vi.mock('../../src/capture.js', () => ({
  Capture: vi.fn().mockImplementation(({ onEvent }) => {
    // Emit meta + snapshot immediately on start
    return {
      start: () => {
        onEvent({ type: 4, data: { href: 'http://localhost/' } });
        onEvent({ type: 2, data: {} });
      },
      stop: vi.fn(),
      triggerCheckpoint: vi.fn(),
    };
  }),
}));

// Mock navigation
vi.mock('../../src/navigation.js', () => ({
  Navigation: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

// Mock indicator
vi.mock('../../src/indicator.js', () => ({
  inject: vi.fn(),
  remove: vi.fn(),
  onEndClick: vi.fn(),
  showPointer: vi.fn(),
  removePointer: vi.fn(),
}));

describe('Session end detection', () => {
  let Session;

  beforeEach(async () => {
    vi.useFakeTimers();
    // Mock fetch globally
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ customerToken: 'dG9r' }),
    });

    // Mock sessionStorage
    const store = {};
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((k) => store[k] || null),
      setItem: vi.fn((k, v) => { store[k] = v; }),
      removeItem: vi.fn((k) => { delete store[k]; }),
    });

    const mod = await import('../../src/session.js');
    Session = mod.Session;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('_cleanup idempotency', () => {
    it('second _cleanup call is a no-op when state is already idle', async () => {
      const onStateChange = vi.fn();
      const session = new Session({
        serverUrl: 'http://localhost:4000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
        onStateChange,
      });

      // Simulate active state
      session._state = 'active';
      session._sessionId = 'sess_1';
      session._tenantId = 'tenant_1';

      // First cleanup
      session._cleanup('remote');
      expect(session._state).toBe('idle');

      onStateChange.mockClear();

      // Second cleanup — should be no-op
      session._cleanup('remote');
      expect(onStateChange).not.toHaveBeenCalled();
    });

    it('_cleanup clears _sessionEndPollTimer', () => {
      const session = new Session({
        serverUrl: 'http://localhost:4000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });

      session._state = 'active';
      session._sessionId = 'sess_1';
      session._sessionEndPollTimer = setTimeout(() => {}, 10000);

      session._cleanup('remote');

      expect(session._sessionEndPollTimer).toBeNull();
    });
  });

  describe('_pollForSessionEnd', () => {
    it('calls _cleanup("remote") when session is not found on server', async () => {
      const session = new Session({
        serverUrl: 'http://localhost:4000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });

      session._state = 'active';
      session._sessionId = 'sess_1';

      // Server returns no session (session ended)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sessionId: null }),
      });

      session._pollForSessionEnd();

      // Advance past the first poll delay (5s)
      await vi.advanceTimersByTimeAsync(5000);

      expect(session._state).toBe('idle');
    });

    it('calls _cleanup("remote") when server returns a different sessionId', async () => {
      const session = new Session({
        serverUrl: 'http://localhost:4000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });

      session._state = 'active';
      session._sessionId = 'sess_1';

      // Server returns a different session
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'sess_other' }),
      });

      session._pollForSessionEnd();

      await vi.advanceTimersByTimeAsync(5000);

      expect(session._state).toBe('idle');
    });

    it('continues polling when session is still active on server', async () => {
      const session = new Session({
        serverUrl: 'http://localhost:4000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });

      session._state = 'active';
      session._sessionId = 'sess_1';

      // Server returns our session (still active)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'sess_1', status: 'active' }),
      });

      session._pollForSessionEnd();

      // First poll at 5s
      await vi.advanceTimersByTimeAsync(5000);
      expect(session._state).toBe('active');
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Second poll at 5s + 7.5s = 12.5s (exponential backoff)
      await vi.advanceTimersByTimeAsync(7500);
      expect(session._state).toBe('active');
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('stops polling when state is not active', async () => {
      const session = new Session({
        serverUrl: 'http://localhost:4000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });

      session._state = 'active';
      session._sessionId = 'sess_1';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'sess_1', status: 'active' }),
      });

      session._pollForSessionEnd();

      // First poll
      await vi.advanceTimersByTimeAsync(5000);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Manually set state to idle (simulates cleanup via Ably)
      session._state = 'idle';

      // Second poll interval passes but should not fetch
      await vi.advanceTimersByTimeAsync(7500);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no additional calls
    });

    it('uses exponential backoff (5s -> 7.5s -> 11.25s)', async () => {
      const session = new Session({
        serverUrl: 'http://localhost:4000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });

      session._state = 'active';
      session._sessionId = 'sess_1';

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'sess_1', status: 'active' }),
      });

      session._pollForSessionEnd();

      // Poll 1 at 5s
      await vi.advanceTimersByTimeAsync(5000);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Poll 2 at 5s + 7.5s = 12.5s
      await vi.advanceTimersByTimeAsync(7500);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);

      // Poll 3 at 12.5s + 11.25s = 23.75s
      await vi.advanceTimersByTimeAsync(11250);
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });
  });
});
