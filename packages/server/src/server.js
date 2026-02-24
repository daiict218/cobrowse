import buildApp from './app.js';
import config from './config.js';
import logger from './utils/logger.js';
import * as db from './db/index.js';
import * as timers from './services/timers.js';
import * as ablyService from './services/ably.js';
import * as audit from './services/audit.js';
import { endSession } from './services/session.js';

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

  const app = await buildApp();

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

// Graceful shutdown — close DB pool and Ably connections cleanly
async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down…');
  await timers.shutdown();
  await db.end();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start();
