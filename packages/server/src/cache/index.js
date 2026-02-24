import config from '../config.js';
import logger from '../utils/logger.js';

/**
 * Cache abstraction layer.
 *
 * Development / demo  → in-memory Map (zero dependencies, zero setup)
 * Production          → Redis via ioredis (set CACHE_DRIVER=redis)
 *
 * Both drivers expose the same async interface so the rest of the
 * codebase is unaware of which is in use.
 *
 * Switching to Redis in production:
 *   1. Set CACHE_DRIVER=redis and REDIS_URL in your env
 *   2. npm install ioredis --workspace=packages/server
 *   That's it — no other code changes needed.
 */

// ─── In-Memory Driver ──────────────────────────────────────────────────────────

class MemoryCache {
  constructor() {
    this._store = new Map();   // key → { value, expiresAt }
    // Periodic cleanup to prevent unbounded memory growth
    setInterval(() => this._evict(), 60_000).unref();
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

// ─── Redis Driver ──────────────────────────────────────────────────────────────

class RedisCache {
  constructor(redisUrl, Redis) {
    this._client = new Redis(redisUrl, { lazyConnect: true });
    this._client.on('error', (err) => logger.error({ err }, 'Redis error'));
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

// ─── Factory ───────────────────────────────────────────────────────────────────

let cache;

if (config.cache.driver === 'redis') {
  logger.info('Cache driver: Redis');
  const { default: Redis } = await import('ioredis');
  cache = new RedisCache(config.cache.redisUrl, Redis);
} else {
  logger.info('Cache driver: in-memory (use CACHE_DRIVER=redis in production)');
  cache = new MemoryCache();
}

export default cache;
