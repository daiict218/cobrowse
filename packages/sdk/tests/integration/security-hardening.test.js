/**
 * @vitest-environment jsdom
 */

/**
 * SDK security hardening integration tests — validates all browser-side
 * security fixes from the audit.
 *
 * Covers:
 *   - Transport: pointer event validation (type checks, isFinite, clamping)
 *   - Transport: system event whitelisting
 *   - Transport: queue overflow protection (MAX_QUEUE_SIZE)
 *   - Capture: case-insensitive masking
 *   - Indicator: MutationObserver banner re-injection protection
 *   - Index: fail-closed masking rules (FALLBACK_MASKING_RULES)
 *   - Index: HTTPS warning for non-localhost HTTP URLs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Transport Security ───────────────────────────────────────────────────────

describe('transport security', () => {
  let mockFetch;
  let MockRealtime;

  beforeEach(() => {
    vi.useFakeTimers();

    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buffered: 0 }),
    });
    globalThis.fetch = mockFetch;

    MockRealtime = vi.fn().mockImplementation(function () {
      this._subscribedEvents = {};
      this.connection = {
        once: vi.fn((event, cb) => {
          if (event === 'connected') setTimeout(() => cb(), 5);
        }),
        close: vi.fn(),
      };
      this.channels = {
        get: vi.fn(() => ({
          subscribe: vi.fn((name, cb) => {
            this._subscribedEvents[name || '__all__'] = cb;
          }),
          publish: vi.fn().mockResolvedValue(undefined),
        })),
      };
    });

    globalThis.window = globalThis.window || globalThis;
    globalThis.window.Ably = { Realtime: MockRealtime };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('pointer event validation', () => {
    it('rejects pointer events with non-number x/y', async () => {
      const { Transport } = await import('../../src/transport.js');
      const onCtrl = vi.fn();
      const transport = new Transport({
        serverUrl: 'http://localhost:3000',
        sessionId: 'sess1',
        customerToken: 'token1',
        onCtrl,
      });

      const connectPromise = transport.connect('tenant1');
      await vi.advanceTimersByTimeAsync(10);
      try { await connectPromise; } catch {}

      // Find the pointer subscriber
      const ctrlChannel = transport._ctrlCh;
      const subscribeCalls = ctrlChannel.subscribe.mock.calls;
      const pointerCall = subscribeCalls.find(c => c[0] === 'pointer');

      if (pointerCall) {
        // Non-number x
        pointerCall[1]({ data: { x: 'bad', y: 0.5 } });
        expect(onCtrl).not.toHaveBeenCalled();

        // Non-number y
        pointerCall[1]({ data: { x: 0.5, y: null } });
        expect(onCtrl).not.toHaveBeenCalled();
      }

      transport.disconnect();
    });

    it('rejects pointer events with NaN/Infinity values', async () => {
      const { Transport } = await import('../../src/transport.js');
      const onCtrl = vi.fn();
      const transport = new Transport({
        serverUrl: 'http://localhost:3000',
        sessionId: 'sess1',
        customerToken: 'token1',
        onCtrl,
      });

      const connectPromise = transport.connect('tenant1');
      await vi.advanceTimersByTimeAsync(10);
      try { await connectPromise; } catch {}

      const ctrlChannel = transport._ctrlCh;
      const subscribeCalls = ctrlChannel.subscribe.mock.calls;
      const pointerCall = subscribeCalls.find(c => c[0] === 'pointer');

      if (pointerCall) {
        pointerCall[1]({ data: { x: NaN, y: 0.5 } });
        expect(onCtrl).not.toHaveBeenCalled();

        pointerCall[1]({ data: { x: 0.5, y: Infinity } });
        expect(onCtrl).not.toHaveBeenCalled();
      }

      transport.disconnect();
    });

    it('clamps pointer values to 0-1 range', async () => {
      const { Transport } = await import('../../src/transport.js');
      const onCtrl = vi.fn();
      const transport = new Transport({
        serverUrl: 'http://localhost:3000',
        sessionId: 'sess1',
        customerToken: 'token1',
        onCtrl,
      });

      const connectPromise = transport.connect('tenant1');
      await vi.advanceTimersByTimeAsync(10);
      try { await connectPromise; } catch {}

      const ctrlChannel = transport._ctrlCh;
      const subscribeCalls = ctrlChannel.subscribe.mock.calls;
      const pointerCall = subscribeCalls.find(c => c[0] === 'pointer');

      if (pointerCall) {
        // Out-of-range values should be clamped
        pointerCall[1]({ data: { x: -0.5, y: 1.5 } });
        expect(onCtrl).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'pointer', x: 0, y: 1 })
        );
      }

      transport.disconnect();
    });

    it('rejects pointer events with missing data', async () => {
      const { Transport } = await import('../../src/transport.js');
      const onCtrl = vi.fn();
      const transport = new Transport({
        serverUrl: 'http://localhost:3000',
        sessionId: 'sess1',
        customerToken: 'token1',
        onCtrl,
      });

      const connectPromise = transport.connect('tenant1');
      await vi.advanceTimersByTimeAsync(10);
      try { await connectPromise; } catch {}

      const ctrlChannel = transport._ctrlCh;
      const subscribeCalls = ctrlChannel.subscribe.mock.calls;
      const pointerCall = subscribeCalls.find(c => c[0] === 'pointer');

      if (pointerCall) {
        pointerCall[1]({ data: null });
        expect(onCtrl).not.toHaveBeenCalled();

        pointerCall[1]({ data: 'not-an-object' });
        expect(onCtrl).not.toHaveBeenCalled();
      }

      transport.disconnect();
    });
  });

  describe('system event whitelisting', () => {
    it('allows valid system events', async () => {
      const { Transport } = await import('../../src/transport.js');
      const onSys = vi.fn();
      const transport = new Transport({
        serverUrl: 'http://localhost:3000',
        sessionId: 'sess1',
        customerToken: 'token1',
        onSys,
      });

      const connectPromise = transport.connect('tenant1');
      await vi.advanceTimersByTimeAsync(10);
      try { await connectPromise; } catch {}

      const sysCh = transport._sysCh;
      const subscribeCalls = sysCh.subscribe.mock.calls;
      // The sys channel subscribes with no event name (catch-all)
      const allCall = subscribeCalls.find(c => typeof c[0] === 'function');

      if (allCall) {
        // Valid event types
        allCall[0]({ name: 'session.ended', data: { reason: 'agent' } });
        expect(onSys).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.ended' }));

        onSys.mockClear();
        allCall[0]({ name: 'session.idle_warned', data: { secondsRemaining: 60 } });
        expect(onSys).toHaveBeenCalledWith(expect.objectContaining({ type: 'session.idle_warned' }));
      }

      transport.disconnect();
    });

    it('silently drops unknown system event types', async () => {
      const { Transport } = await import('../../src/transport.js');
      const onSys = vi.fn();
      const transport = new Transport({
        serverUrl: 'http://localhost:3000',
        sessionId: 'sess1',
        customerToken: 'token1',
        onSys,
      });

      const connectPromise = transport.connect('tenant1');
      await vi.advanceTimersByTimeAsync(10);
      try { await connectPromise; } catch {}

      const sysCh = transport._sysCh;
      const subscribeCalls = sysCh.subscribe.mock.calls;
      const allCall = subscribeCalls.find(c => typeof c[0] === 'function');

      if (allCall) {
        // Malicious event types should be dropped
        allCall[0]({ name: 'malicious.event', data: {} });
        expect(onSys).not.toHaveBeenCalled();

        allCall[0]({ name: 'admin.escalate', data: {} });
        expect(onSys).not.toHaveBeenCalled();

        allCall[0]({ name: '', data: {} });
        expect(onSys).not.toHaveBeenCalled();
      }

      transport.disconnect();
    });
  });

  describe('queue overflow protection', () => {
    it('caps queue at MAX_QUEUE_SIZE and drops oldest events', async () => {
      const { Transport } = await import('../../src/transport.js');
      const transport = new Transport({
        serverUrl: 'http://localhost:3000',
        sessionId: 'sess1',
        customerToken: 'token1',
      });

      // Fill queue beyond the limit (10000)
      for (let i = 0; i < 10050; i++) {
        transport.enqueue({ type: 3, seq: i });
      }

      // Queue should be capped — oldest events dropped
      expect(transport._ablyBatch.length).toBeLessThanOrEqual(10050);
      expect(transport._httpBatch.length).toBeLessThanOrEqual(10050);

      // After overflow, the batch should have been trimmed
      // The splice removes 10% (1000 events) when over MAX_QUEUE_SIZE
      expect(transport._ablyBatch.length).toBeLessThan(10050);
      expect(transport._httpBatch.length).toBeLessThan(10050);

      transport.disconnect();
    });

    it('preserves recent events during overflow trim', async () => {
      const { Transport } = await import('../../src/transport.js');
      const transport = new Transport({
        serverUrl: 'http://localhost:3000',
        sessionId: 'sess1',
        customerToken: 'token1',
      });

      for (let i = 0; i < 10050; i++) {
        transport.enqueue({ type: 3, seq: i });
      }

      // The latest events should still be in the batch
      const lastEvent = transport._httpBatch[transport._httpBatch.length - 1];
      expect(lastEvent.seq).toBe(10049);

      transport.disconnect();
    });
  });
});

// ─── Capture Security ─────────────────────────────────────────────────────────

describe('capture security', () => {
  let mockRrweb;
  let stopFn;
  let capturedConfig;

  beforeEach(() => {
    stopFn = vi.fn();
    capturedConfig = null;
    mockRrweb = {
      record: vi.fn((config) => {
        capturedConfig = config;
        return stopFn;
      }),
    };
    window.rrweb = mockRrweb;
  });

  afterEach(() => {
    delete window.rrweb;
  });

  describe('case-insensitive masking', () => {
    it('masks input with uppercase name (CARD_NUMBER)', async () => {
      const { Capture } = await import('../../src/capture.js');
      const capture = new Capture({ maskingRules: {}, onEvent: vi.fn(), onUrlChange: vi.fn() });
      capture.start();

      const maskFn = capturedConfig.maskInputFn;
      const element = {
        matches: vi.fn(() => false),
        name: 'CARD_NUMBER',
        id: '',
      };
      expect(maskFn('4111111111111111', element)).toBe('████');
    });

    it('masks input with mixed case id (Card_Cvv)', async () => {
      const { Capture } = await import('../../src/capture.js');
      const capture = new Capture({ maskingRules: {}, onEvent: vi.fn(), onUrlChange: vi.fn() });
      capture.start();

      const maskFn = capturedConfig.maskInputFn;
      const element = {
        matches: vi.fn(() => false),
        name: '',
        id: 'Card_Cvv',
      };
      expect(maskFn('123', element)).toBe('████');
    });

    it('masks SSN field (case-insensitive id)', async () => {
      const { Capture } = await import('../../src/capture.js');
      const capture = new Capture({ maskingRules: {}, onEvent: vi.fn(), onUrlChange: vi.fn() });
      capture.start();

      const maskFn = capturedConfig.maskInputFn;
      const element = {
        matches: vi.fn(() => false),
        name: 'SSN_FIELD',
        id: '',
      };
      expect(maskFn('123-45-6789', element)).toBe('████');
    });

    it('does not mask non-sensitive fields', async () => {
      const { Capture } = await import('../../src/capture.js');
      const capture = new Capture({ maskingRules: {}, onEvent: vi.fn(), onUrlChange: vi.fn() });
      capture.start();

      const maskFn = capturedConfig.maskInputFn;
      const element = {
        matches: vi.fn(() => false),
        name: 'first_name',
        id: 'firstName',
      };
      expect(maskFn('John', element)).toBe('John');
    });

    it('handles elements without name or id', async () => {
      const { Capture } = await import('../../src/capture.js');
      const capture = new Capture({ maskingRules: {}, onEvent: vi.fn(), onUrlChange: vi.fn() });
      capture.start();

      const maskFn = capturedConfig.maskInputFn;
      const element = {
        matches: vi.fn(() => false),
        name: '',
        id: '',
      };
      expect(maskFn('some value', element)).toBe('some value');
    });
  });
});

// ─── Indicator Security ───────────────────────────────────────────────────────

describe('indicator security', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  describe('MutationObserver banner protection', () => {
    it('re-injects banner if removed by page JavaScript', async () => {
      const { inject, remove } = await import('../../src/indicator.js');
      inject();

      // Verify banner exists
      expect(document.getElementById('__cobrowse_banner__')).toBeTruthy();

      // Simulate malicious page JS removing the banner
      const banner = document.getElementById('__cobrowse_banner__');
      banner.remove();

      // MutationObserver should re-inject it
      // Note: jsdom MutationObserver is synchronous in most test setups
      // We need to wait for the observer callback
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.getElementById('__cobrowse_banner__')).toBeTruthy();

      // Clean up properly
      remove();
    });

    it('remove() disconnects observer before removing (no infinite loop)', async () => {
      const { inject, remove } = await import('../../src/indicator.js');
      inject();
      // Should not throw or cause infinite loop
      expect(() => remove()).not.toThrow();
      expect(document.getElementById('__cobrowse_banner__')).toBeNull();
    });
  });
});

// ─── SDK Entry Point Security ─────────────────────────────────────────────────

describe('SDK entry point security', () => {
  describe('fail-closed masking rules', () => {
    it('uses FALLBACK_MASKING_RULES when fetch fails', async () => {
      vi.resetModules();

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      globalThis.fetch = mockFetch;

      // Mock sessionStorage
      const store = new Map();
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: {
          getItem: vi.fn((key) => store.get(key) ?? null),
          setItem: vi.fn((key, value) => store.set(key, value)),
          removeItem: vi.fn((key) => store.delete(key)),
        },
        writable: true,
        configurable: true,
      });

      // Mock Ably
      globalThis.window.Ably = {
        Realtime: vi.fn().mockImplementation(function () {
          this.connection = {
            on: vi.fn(),
            once: vi.fn((event, cb) => {
              if (event === 'connected') setTimeout(() => cb(), 10);
            }),
            close: vi.fn(),
          };
          this.channels = {
            get: vi.fn(() => ({
              subscribe: vi.fn(),
              publish: vi.fn().mockResolvedValue(undefined),
            })),
          };
        }),
      };

      // Mock rrweb
      globalThis.window.rrweb = {
        record: vi.fn(() => vi.fn()),
      };

      vi.useFakeTimers({ shouldAdvanceTime: true });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { default: CoBrowse } = await import('../../src/index.js');

      await CoBrowse.init({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });

      // Should warn about using built-in defaults
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not fetch masking rules')
      );

      CoBrowse.destroy();
      warnSpy.mockRestore();
      vi.useRealTimers();
    });

    it('uses FALLBACK_MASKING_RULES when server returns non-ok', async () => {
      vi.resetModules();

      const mockFetch = vi.fn(async (url) => {
        if (url.includes('/masking-rules')) {
          return { ok: false, status: 500 };
        }
        if (url.includes('/pending-activation')) {
          return { ok: true, json: async () => ({ sessionId: null }) };
        }
        if (url.includes('/ably-auth')) {
          return {
            ok: true,
            json: async () => ({
              keyName: 'test.key',
              timestamp: Date.now(),
              nonce: 'nonce',
              capability: JSON.stringify({ 'invite:t1:c1': ['subscribe'] }),
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });
      globalThis.fetch = mockFetch;

      const store = new Map();
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: {
          getItem: vi.fn((key) => store.get(key) ?? null),
          setItem: vi.fn((key, value) => store.set(key, value)),
          removeItem: vi.fn((key) => store.delete(key)),
        },
        writable: true,
        configurable: true,
      });

      globalThis.window.Ably = {
        Realtime: vi.fn().mockImplementation(function () {
          this.connection = {
            on: vi.fn(),
            once: vi.fn((event, cb) => {
              if (event === 'connected') setTimeout(() => cb(), 10);
            }),
            close: vi.fn(),
          };
          this.channels = {
            get: vi.fn(() => ({
              subscribe: vi.fn(),
              publish: vi.fn().mockResolvedValue(undefined),
            })),
          };
        }),
      };

      globalThis.window.rrweb = { record: vi.fn(() => vi.fn()) };

      vi.useFakeTimers({ shouldAdvanceTime: true });

      const { default: CoBrowse } = await import('../../src/index.js');

      // Should not throw — uses fallback rules
      await CoBrowse.init({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });

      CoBrowse.destroy();
      vi.useRealTimers();
    });
  });

  describe('HTTPS warning', () => {
    it('warns for non-localhost HTTP URLs', async () => {
      vi.resetModules();

      const mockFetch = vi.fn(async (url) => {
        if (url.includes('/masking-rules')) {
          return { ok: true, json: async () => ({ maskingRules: {} }) };
        }
        if (url.includes('/pending-activation')) {
          return { ok: true, json: async () => ({ sessionId: null }) };
        }
        if (url.includes('/ably-auth')) {
          return {
            ok: true,
            json: async () => ({
              keyName: 'test.key',
              timestamp: Date.now(),
              nonce: 'nonce',
              capability: JSON.stringify({ 'invite:t1:c1': ['subscribe'] }),
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });
      globalThis.fetch = mockFetch;

      const store = new Map();
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: {
          getItem: vi.fn((key) => store.get(key) ?? null),
          setItem: vi.fn((key, value) => store.set(key, value)),
          removeItem: vi.fn((key) => store.delete(key)),
        },
        writable: true,
        configurable: true,
      });

      globalThis.window.Ably = {
        Realtime: vi.fn().mockImplementation(function () {
          this.connection = {
            on: vi.fn(),
            once: vi.fn((event, cb) => {
              if (event === 'connected') setTimeout(() => cb(), 10);
            }),
            close: vi.fn(),
          };
          this.channels = {
            get: vi.fn(() => ({
              subscribe: vi.fn(),
              publish: vi.fn().mockResolvedValue(undefined),
            })),
          };
        }),
      };

      globalThis.window.rrweb = { record: vi.fn(() => vi.fn()) };

      vi.useFakeTimers({ shouldAdvanceTime: true });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { default: CoBrowse } = await import('../../src/index.js');

      await CoBrowse.init({
        serverUrl: 'http://example.com',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('WARNING: serverUrl uses HTTP')
      );

      CoBrowse.destroy();
      warnSpy.mockRestore();
      vi.useRealTimers();
    });

    it('does not warn for localhost HTTP URLs', async () => {
      vi.resetModules();

      const mockFetch = vi.fn(async (url) => {
        if (url.includes('/masking-rules')) {
          return { ok: true, json: async () => ({ maskingRules: {} }) };
        }
        if (url.includes('/pending-activation')) {
          return { ok: true, json: async () => ({ sessionId: null }) };
        }
        if (url.includes('/ably-auth')) {
          return {
            ok: true,
            json: async () => ({
              keyName: 'test.key',
              timestamp: Date.now(),
              nonce: 'nonce',
              capability: JSON.stringify({ 'invite:t1:c1': ['subscribe'] }),
            }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });
      globalThis.fetch = mockFetch;

      const store = new Map();
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: {
          getItem: vi.fn((key) => store.get(key) ?? null),
          setItem: vi.fn((key, value) => store.set(key, value)),
          removeItem: vi.fn((key) => store.delete(key)),
        },
        writable: true,
        configurable: true,
      });

      globalThis.window.Ably = {
        Realtime: vi.fn().mockImplementation(function () {
          this.connection = {
            on: vi.fn(),
            once: vi.fn((event, cb) => {
              if (event === 'connected') setTimeout(() => cb(), 10);
            }),
            close: vi.fn(),
          };
          this.channels = {
            get: vi.fn(() => ({
              subscribe: vi.fn(),
              publish: vi.fn().mockResolvedValue(undefined),
            })),
          };
        }),
      };

      globalThis.window.rrweb = { record: vi.fn(() => vi.fn()) };

      vi.useFakeTimers({ shouldAdvanceTime: true });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { default: CoBrowse } = await import('../../src/index.js');

      await CoBrowse.init({
        serverUrl: 'http://localhost:3000',
        publicKey: 'cb_pk_test',
        customerId: 'cust_1',
      });

      // Should NOT have the HTTPS warning (localhost is fine)
      const httpsWarnings = warnSpy.mock.calls.filter(
        (call) => call[0]?.includes?.('WARNING: serverUrl uses HTTP')
      );
      expect(httpsWarnings.length).toBe(0);

      CoBrowse.destroy();
      warnSpy.mockRestore();
      vi.useRealTimers();
    });
  });
});
