'use strict';

const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

// Single connection pool shared across the whole process.
// pg's Pool manages connection lifecycle, health checks, and retries.
const pool = new Pool({
  connectionString: config.db.url,
  ssl: config.db.ssl,
  max: 20,               // max connections in pool
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

/**
 * Execute a parameterised query.
 *
 * All DB calls go through this function so we have a single place to add
 * query logging, metrics, or retries in the future.
 *
 * @param {string} text   — SQL with $1, $2 ... placeholders
 * @param {Array}  params — parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    logger.debug({ query: text, duration: Date.now() - start, rows: result.rowCount }, 'db query');
    return result;
  } catch (err) {
    logger.error({ err, query: text }, 'db query error');
    throw err;
  }
}

/**
 * Run multiple queries inside a transaction.
 * The callback receives a { query } object scoped to the transaction client.
 *
 * @param {Function} fn — async (client) => result
 */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({ query: (text, params) => client.query(text, params) });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function end() {
  await pool.end();
}

module.exports = { query, transaction, end };
