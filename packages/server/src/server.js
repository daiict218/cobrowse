'use strict';

const buildApp = require('./app');
const config   = require('./config');
const logger   = require('./utils/logger');
const db       = require('./db');

async function start() {
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
  await db.end();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start();
