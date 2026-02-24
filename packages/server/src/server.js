import buildApp from './app.js';
import config from './config.js';
import logger from './utils/logger.js';
import * as db from './db/index.js';
import cache from './cache/index.js';
import * as timers from './services/timers.js';
import * as ablyService from './services/ably.js';
import * as audit from './services/audit.js';
import { endSession } from './services/session.js';

let app;

async function start() {
  // Clean up ALL pending/active sessions from previous server runs.
  // In-process timers (idle, max-duration) don't survive restarts, so any
  // leftover sessions would be orphaned. End them to prevent the SDK from
  // picking up stale sessions via polling.
  try {
    const { rowCount } = await db.query(
      `UPDATE sessions SET status = 'ended', ended_at = NOW(), end_reason = 'server_restart'
       WHERE status IN ('pending', 'active')`
    );
    if (rowCount > 0) {
      logger.info({ count: rowCount }, 'cleaned up stale sessions on startup');
    }
  } catch (err) {
    logger.warn({ err }, 'failed to clean up stale sessions (non-fatal)');
  }

  // Initialise distributed session timers (BullMQ when CACHE_DRIVER=redis,
  // in-process setTimeout otherwise). Callbacks avoid circular deps.
  timers.init({
    endSession,
    publishIdleWarning: async (tenantId, sessionId, secondsRemaining) => {
      await ablyService.publishSysEvent(tenantId, sessionId, 'session.idle_warned', {
        secondsRemaining,
      });
    },
    logAuditEvent: async (params) => {
      await audit.logEvent(params);
    },
  });

  app = await buildApp();

  try {
    await app.listen({ port: config.server.port, host: config.server.host });
    logger.info(
      { port: config.server.port, env: config.env },
      `CoBrowse server running`
    );
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// Order: stop accepting requests → drain timers → close cache → close DB pool
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;     // prevent double-shutdown from rapid signals
  shuttingDown = true;

  logger.info({ signal }, 'Shutting down…');

  // 1. Stop accepting new HTTP connections, finish in-flight requests
  if (app) {
    try {
      await app.close();
      logger.info('Fastify server closed');
    } catch (err) {
      logger.error({ err }, 'Error closing Fastify server');
    }
  }

  // 2. Stop session timers (BullMQ worker + queue, or in-process timers)
  try {
    await timers.shutdown();
  } catch (err) {
    logger.error({ err }, 'Error shutting down timers');
  }

  // 3. Close cache (Redis connection if CACHE_DRIVER=redis)
  if (typeof cache.shutdown === 'function') {
    try {
      await cache.shutdown();
      logger.info('Cache connection closed');
    } catch (err) {
      logger.error({ err }, 'Error closing cache connection');
    }
  }

  // 4. Close PostgreSQL connection pool (waits for idle connections to drain)
  try {
    await db.end();
    logger.info('Database pool closed');
  } catch (err) {
    logger.error({ err }, 'Error closing database pool');
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start();
