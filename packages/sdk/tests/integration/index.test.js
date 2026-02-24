/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to re-import CoBrowse fresh for each test to reset _session
describe('CoBrowse (SDK entry point)', () => {
  let mockFetch;

  beforeEach(() => {
    vi.resetModules();

    // Mock fetch
    mockFetch = vi.fn(async (url) => {
      if (url.includes('/api/v1/public/masking-rules')) {
        return { ok: true, json: async () => ({ maskingRules: {} }) };
      }
      if (url.includes('/api/v1/ably-auth')) {
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
      if (url.includes('/pending-activation')) {
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('requires serverUrl, publicKey, customerId', async () => {
    const { default: CoBrowse } = await import('../../src/index.js');
    await expect(
      CoBrowse.init({ serverUrl: '', publicKey: '', customerId: '' })
    ).rejects.toThrow('required');
  });

  it('rejects missing serverUrl', async () => {
    const { default: CoBrowse } = await import('../../src/index.js');
    await expect(
      CoBrowse.init({ publicKey: 'cb_pk_test', customerId: 'cust_1' })
    ).rejects.toThrow('required');
  });

  it('initializes and fetches masking rules', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { default: CoBrowse } = await import('../../src/index.js');
    await CoBrowse.init({
      serverUrl: 'http://localhost:3000',
      publicKey: 'cb_pk_test',
      customerId: 'cust_1',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/public/masking-rules'),
      expect.anything(),
    );

    CoBrowse.destroy();
  });

  it('warns on double init', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { default: CoBrowse } = await import('../../src/index.js');

    await CoBrowse.init({
      serverUrl: 'http://localhost:3000',
      publicKey: 'cb_pk_test',
      customerId: 'cust_1',
    });

    await CoBrowse.init({
      serverUrl: 'http://localhost:3000',
      publicKey: 'cb_pk_test',
      customerId: 'cust_1',
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Already initialised'));

    CoBrowse.destroy();
    warnSpy.mockRestore();
  });

  it('getState returns idle before init', async () => {
    const { default: CoBrowse } = await import('../../src/index.js');
    expect(CoBrowse.getState()).toBe('idle');
  });

  it('use() registers plugins', async () => {
    const { default: CoBrowse } = await import('../../src/index.js');
    const plugin = { init: vi.fn(), onStateChange: vi.fn() };
    const result = CoBrowse.use(plugin);
    expect(result).toBe(CoBrowse); // chainable
  });

  it('use() rejects non-object plugins', async () => {
    const { default: CoBrowse } = await import('../../src/index.js');
    expect(() => CoBrowse.use(null)).toThrow('Plugin must be an object');
    expect(() => CoBrowse.use('string')).toThrow('Plugin must be an object');
  });

  it('endSession delegates to session', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { default: CoBrowse } = await import('../../src/index.js');
    // Should not throw when no session
    CoBrowse.endSession();
  });

  it('destroy resets session', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { default: CoBrowse } = await import('../../src/index.js');

    await CoBrowse.init({
      serverUrl: 'http://localhost:3000',
      publicKey: 'cb_pk_test',
      customerId: 'cust_1',
    });

    CoBrowse.destroy();
    expect(CoBrowse.getState()).toBe('idle');
  });
});
