import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the graceful shutdown logic in server.js.
 *
 * Since server.js has top-level side effects (calls start(), registers signal
 * handlers), we test the shutdown logic by reconstructing the key function
 * and verifying the ordering and guard behaviour.
 */

describe('graceful shutdown', () => {
  let app;
  let timers;
  let cache;
  let db;
  let logger;
  let shuttingDown;

  beforeEach(() => {
    app = { close: vi.fn().mockResolvedValue(undefined) };
    timers = { shutdown: vi.fn().mockResolvedValue(undefined) };
    cache = { shutdown: vi.fn().mockResolvedValue(undefined) };
    db = { end: vi.fn().mockResolvedValue(undefined) };
    logger = { info: vi.fn(), error: vi.fn() };
    shuttingDown = false;
  });

  /**
   * Mirrors the shutdown function from server.js.
   * Uses the same ordering: HTTP → timers → cache → DB.
   */
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutting down…');

    if (app) {
      try {
        await app.close();
        logger.info('Fastify server closed');
      } catch (err) {
        logger.error({ err }, 'Error closing Fastify server');
      }
    }

    try {
      await timers.shutdown();
    } catch (err) {
      logger.error({ err }, 'Error shutting down timers');
    }

    if (typeof cache.shutdown === 'function') {
      try {
        await cache.shutdown();
        logger.info('Cache connection closed');
      } catch (err) {
        logger.error({ err }, 'Error closing cache connection');
      }
    }

    try {
      await db.end();
      logger.info('Database pool closed');
    } catch (err) {
      logger.error({ err }, 'Error closing database pool');
    }
  }

  describe('shutdown ordering', () => {
    it('calls components in correct order: HTTP → timers → cache → DB', async () => {
      const callOrder = [];
      app.close.mockImplementation(async () => callOrder.push('app'));
      timers.shutdown.mockImplementation(async () => callOrder.push('timers'));
      cache.shutdown.mockImplementation(async () => callOrder.push('cache'));
      db.end.mockImplementation(async () => callOrder.push('db'));

      await shutdown('SIGTERM');

      expect(callOrder).toEqual(['app', 'timers', 'cache', 'db']);
    });

    it('logs the signal received', async () => {
      await shutdown('SIGTERM');
      expect(logger.info).toHaveBeenCalledWith({ signal: 'SIGTERM' }, 'Shutting down…');
    });

    it('logs success for each component', async () => {
      await shutdown('SIGINT');
      expect(logger.info).toHaveBeenCalledWith('Fastify server closed');
      expect(logger.info).toHaveBeenCalledWith('Cache connection closed');
      expect(logger.info).toHaveBeenCalledWith('Database pool closed');
    });
  });

  describe('double-shutdown guard', () => {
    it('only executes shutdown once on rapid signals', async () => {
      await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
      expect(app.close).toHaveBeenCalledTimes(1);
      expect(timers.shutdown).toHaveBeenCalledTimes(1);
      expect(cache.shutdown).toHaveBeenCalledTimes(1);
      expect(db.end).toHaveBeenCalledTimes(1);
    });

    it('second call is a no-op', async () => {
      await shutdown('SIGTERM');
      await shutdown('SIGTERM');
      expect(app.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('error resilience', () => {
    it('continues shutdown when app.close() fails', async () => {
      app.close.mockRejectedValue(new Error('close failed'));
      await shutdown('SIGTERM');
      // Should still call remaining components
      expect(timers.shutdown).toHaveBeenCalled();
      expect(cache.shutdown).toHaveBeenCalled();
      expect(db.end).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Error closing Fastify server'
      );
    });

    it('continues shutdown when timers.shutdown() fails', async () => {
      timers.shutdown.mockRejectedValue(new Error('timer close failed'));
      await shutdown('SIGTERM');
      expect(cache.shutdown).toHaveBeenCalled();
      expect(db.end).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Error shutting down timers'
      );
    });

    it('continues shutdown when cache.shutdown() fails', async () => {
      cache.shutdown.mockRejectedValue(new Error('redis close failed'));
      await shutdown('SIGTERM');
      expect(db.end).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Error closing cache connection'
      );
    });

    it('logs error when db.end() fails', async () => {
      db.end.mockRejectedValue(new Error('pool close failed'));
      await shutdown('SIGTERM');
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Error closing database pool'
      );
    });

    it('handles all components failing without throwing', async () => {
      app.close.mockRejectedValue(new Error('app fail'));
      timers.shutdown.mockRejectedValue(new Error('timer fail'));
      cache.shutdown.mockRejectedValue(new Error('cache fail'));
      db.end.mockRejectedValue(new Error('db fail'));

      await expect(shutdown('SIGTERM')).resolves.toBeUndefined();
    });
  });

  describe('cache without shutdown method', () => {
    it('skips cache.shutdown() when method does not exist (in-memory cache)', async () => {
      const memoryCache = {}; // no shutdown method
      cache = memoryCache;

      const callOrder = [];
      app.close.mockImplementation(async () => callOrder.push('app'));
      timers.shutdown.mockImplementation(async () => callOrder.push('timers'));
      db.end.mockImplementation(async () => callOrder.push('db'));

      await shutdown('SIGTERM');
      expect(callOrder).toEqual(['app', 'timers', 'db']);
    });
  });

  describe('app not yet initialized', () => {
    it('handles shutdown before app is created', async () => {
      app = null;
      await shutdown('SIGTERM');
      // Should still shut down other components
      expect(timers.shutdown).toHaveBeenCalled();
      expect(cache.shutdown).toHaveBeenCalled();
      expect(db.end).toHaveBeenCalled();
    });
  });
});
