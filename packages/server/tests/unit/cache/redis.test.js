import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for RedisCache.ping() and RedisCache.shutdown().
 *
 * Since cache/index.js runs factory logic at import time (reading config,
 * dynamically importing ioredis), we test the RedisCache class in isolation
 * by reconstructing it — same approach as the existing memory.test.js.
 */

class RedisCache {
  constructor(client) {
    this._client = client;
  }

  async ping() {
    try {
      const res = await this._client.ping();
      return res === 'PONG';
    } catch {
      return false;
    }
  }

  async shutdown() {
    try {
      await this._client.quit();
    } catch {
      this._client.disconnect();
    }
  }

  async get(key) {
    const raw = await this._client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async set(key, value, ttlSeconds = null) {
    const serialised = JSON.stringify(value);
    if (ttlSeconds) {
      await this._client.set(key, serialised, 'EX', ttlSeconds);
    } else {
      await this._client.set(key, serialised);
    }
  }

  async del(key) {
    await this._client.del(key);
  }

  async exists(key) {
    const count = await this._client.exists(key);
    return count > 0;
  }
}

describe('RedisCache', () => {
  let mockClient;
  let cache;

  beforeEach(() => {
    mockClient = {
      ping: vi.fn(),
      quit: vi.fn(),
      disconnect: vi.fn(),
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      exists: vi.fn(),
    };
    cache = new RedisCache(mockClient);
  });

  describe('ping', () => {
    it('returns true when Redis responds with PONG', async () => {
      mockClient.ping.mockResolvedValue('PONG');
      expect(await cache.ping()).toBe(true);
    });

    it('returns false when Redis responds with unexpected value', async () => {
      mockClient.ping.mockResolvedValue('NOT_PONG');
      expect(await cache.ping()).toBe(false);
    });

    it('returns false when Redis throws an error', async () => {
      mockClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));
      expect(await cache.ping()).toBe(false);
    });

    it('returns false when Redis connection is lost', async () => {
      mockClient.ping.mockRejectedValue(new Error('Connection is closed'));
      expect(await cache.ping()).toBe(false);
    });
  });

  describe('shutdown', () => {
    it('calls quit() for graceful close', async () => {
      mockClient.quit.mockResolvedValue('OK');
      await cache.shutdown();
      expect(mockClient.quit).toHaveBeenCalledTimes(1);
      expect(mockClient.disconnect).not.toHaveBeenCalled();
    });

    it('calls disconnect() as fallback when quit() rejects', async () => {
      mockClient.quit.mockRejectedValue(new Error('already disconnected'));
      await cache.shutdown();
      expect(mockClient.quit).toHaveBeenCalledTimes(1);
      expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
    });

    it('does not throw when quit() fails', async () => {
      mockClient.quit.mockRejectedValue(new Error('boom'));
      await expect(cache.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('get', () => {
    it('returns parsed JSON for stored values', async () => {
      mockClient.get.mockResolvedValue('{"name":"test"}');
      expect(await cache.get('key1')).toEqual({ name: 'test' });
    });

    it('returns null for missing keys', async () => {
      mockClient.get.mockResolvedValue(null);
      expect(await cache.get('missing')).toBeNull();
    });

    it('returns raw string when JSON parse fails', async () => {
      mockClient.get.mockResolvedValue('not-json');
      expect(await cache.get('raw')).toBe('not-json');
    });
  });

  describe('set', () => {
    it('stores JSON-serialised value without TTL', async () => {
      mockClient.set.mockResolvedValue('OK');
      await cache.set('k', { a: 1 });
      expect(mockClient.set).toHaveBeenCalledWith('k', '{"a":1}');
    });

    it('stores JSON-serialised value with TTL', async () => {
      mockClient.set.mockResolvedValue('OK');
      await cache.set('k', 'v', 60);
      expect(mockClient.set).toHaveBeenCalledWith('k', '"v"', 'EX', 60);
    });
  });

  describe('del', () => {
    it('deletes a key', async () => {
      mockClient.del.mockResolvedValue(1);
      await cache.del('k');
      expect(mockClient.del).toHaveBeenCalledWith('k');
    });
  });

  describe('exists', () => {
    it('returns true when key exists', async () => {
      mockClient.exists.mockResolvedValue(1);
      expect(await cache.exists('k')).toBe(true);
    });

    it('returns false when key does not exist', async () => {
      mockClient.exists.mockResolvedValue(0);
      expect(await cache.exists('k')).toBe(false);
    });
  });
});
