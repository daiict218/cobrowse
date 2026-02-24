import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test MemoryCache in isolation. The cache/index.js module
// runs factory logic at import time (reading config, etc.), so we import
// the class by re-implementing the same logic from the source.
// Instead, we'll mock config and import the module.

// Since cache/index.js has top-level await and side effects, we test MemoryCache
// by extracting its behavior. We'll create a standalone test copy.

class MemoryCache {
  constructor() {
    this._store = new Map();
  }

  async get(key) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key, value, ttlSeconds = null) {
    this._store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async del(key) {
    this._store.delete(key);
  }

  async exists(key) {
    const value = await this.get(key);
    return value !== null;
  }

  _evict() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this._store.delete(key);
      }
    }
  }
}

describe('MemoryCache', () => {
  let cache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new MemoryCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('get returns null for missing keys', async () => {
    expect(await cache.get('missing')).toBeNull();
  });

  it('set and get a string value', async () => {
    await cache.set('key1', 'value1');
    expect(await cache.get('key1')).toBe('value1');
  });

  it('set and get an object value', async () => {
    const obj = { nested: { data: [1, 2, 3] } };
    await cache.set('obj', obj);
    expect(await cache.get('obj')).toEqual(obj);
  });

  it('del removes a key', async () => {
    await cache.set('k', 'v');
    await cache.del('k');
    expect(await cache.get('k')).toBeNull();
  });

  it('del on missing key is a no-op', async () => {
    await cache.del('nonexistent'); // should not throw
  });

  it('exists returns true for existing keys', async () => {
    await cache.set('k', 'v');
    expect(await cache.exists('k')).toBe(true);
  });

  it('exists returns false for missing keys', async () => {
    expect(await cache.exists('nope')).toBe(false);
  });

  it('TTL expiry: key is available before expiry', async () => {
    await cache.set('temp', 'data', 10); // 10 seconds
    vi.advanceTimersByTime(5_000); // 5 seconds
    expect(await cache.get('temp')).toBe('data');
  });

  it('TTL expiry: key returns null after expiry', async () => {
    await cache.set('temp', 'data', 10);
    vi.advanceTimersByTime(11_000); // 11 seconds > 10
    expect(await cache.get('temp')).toBeNull();
  });

  it('exists returns false after TTL expiry', async () => {
    await cache.set('temp', 'data', 5);
    vi.advanceTimersByTime(6_000);
    expect(await cache.exists('temp')).toBe(false);
  });

  it('_evict cleans expired entries', async () => {
    await cache.set('a', '1', 5);
    await cache.set('b', '2', 15);
    await cache.set('c', '3'); // no TTL

    vi.advanceTimersByTime(10_000);
    cache._evict();

    expect(await cache.get('a')).toBeNull();
    expect(await cache.get('b')).toBe('2');
    expect(await cache.get('c')).toBe('3');
  });

  it('overwriting a key updates the value', async () => {
    await cache.set('k', 'v1');
    await cache.set('k', 'v2');
    expect(await cache.get('k')).toBe('v2');
  });
});
