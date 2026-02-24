import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import * as db from '../db/index.js';
import cache from '../cache/index.js';
import storage from '../storage/index.js';
import logger from '../utils/logger.js';
import { recordingEventsTotal, recordingSizeBytes } from '../utils/metrics.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Recording service — manages the lifecycle of session recordings.
 *
 * Key design decisions:
 *   1. Events buffer in cache and flush to storage every FLUSH_THRESHOLD events
 *      or on session end — this minimises storage writes while bounding memory.
 *   2. All recording failures are non-fatal (try/catch, log warning).
 *      A recording failure must never break the live co-browse session.
 *   3. Events are already masked before reaching this service — we persist
 *      exactly what the agent would see in the live view.
 */

const BUFFER_KEY = (sessionId) => `rec_buf:${sessionId}`;
const FLUSH_THRESHOLD = 500;

// ─── Feature flag check ──────────────────────────────────────────────────────

async function isEnabled(tenantId) {
  try {
    const result = await db.query(
      `SELECT feature_flags FROM tenants WHERE id = $1`,
      [tenantId]
    );
    if (!result.rows.length) return false;
    const flags = result.rows[0].feature_flags || {};
    return flags.sessionReplay === true;
  } catch (err) {
    logger.warn({ err, tenantId }, 'recording.isEnabled: check failed');
    return false;
  }
}

// ─── Start recording ─────────────────────────────────────────────────────────

async function startRecording(sessionId, tenantId, initialSnapshot) {
  try {
    const enabled = await isEnabled(tenantId);
    if (!enabled) return null;

    const storageKey = `${sessionId}.gz`;

    const result = await db.query(
      `INSERT INTO session_recordings (session_id, tenant_id, storage_key, status)
       VALUES ($1, $2, $3, 'recording')
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [sessionId, tenantId, storageKey]
    );

    if (!result.rows.length) {
      // Recording already exists for this session (idempotent)
      return null;
    }

    // Store initial snapshot in the buffer
    if (initialSnapshot) {
      const events = Array.isArray(initialSnapshot) ? initialSnapshot : [initialSnapshot];
      await cache.set(BUFFER_KEY(sessionId), events, 7200);
    }

    logger.info({ sessionId, tenantId }, 'recording started');
    return result.rows[0];
  } catch (err) {
    logger.warn({ err, sessionId }, 'recording.startRecording failed (non-fatal)');
    return null;
  }
}

// ─── Buffer events ───────────────────────────────────────────────────────────

async function bufferEvents(sessionId, events) {
  try {
    const key = BUFFER_KEY(sessionId);
    let buffer = await cache.get(key) || [];
    buffer.push(...events);

    recordingEventsTotal.inc(events.length);

    // Auto-flush when buffer exceeds threshold
    if (buffer.length >= FLUSH_THRESHOLD) {
      await _flushToStorage(sessionId, buffer);
      buffer = [];
    }

    await cache.set(key, buffer, 7200);
  } catch (err) {
    logger.warn({ err, sessionId }, 'recording.bufferEvents failed (non-fatal)');
  }
}

// ─── Flush buffer to storage ─────────────────────────────────────────────────

async function flushBuffer(sessionId) {
  try {
    const key = BUFFER_KEY(sessionId);
    const buffer = await cache.get(key);
    if (!buffer || buffer.length === 0) return;

    await _flushToStorage(sessionId, buffer);
    await cache.set(key, [], 7200);
  } catch (err) {
    logger.warn({ err, sessionId }, 'recording.flushBuffer failed (non-fatal)');
  }
}

async function _flushToStorage(sessionId, events) {
  // Look up the storage key from DB
  const rec = await db.query(
    `SELECT storage_key, event_count FROM session_recordings WHERE session_id = $1 AND status = 'recording'`,
    [sessionId]
  );
  if (!rec.rows.length) return;

  const { storage_key, event_count } = rec.rows[0];

  // Load existing compressed data if any, append new events
  let allEvents = [];
  const existing = await storage.get(storage_key);
  if (existing) {
    const decompressed = await gunzipAsync(existing);
    allEvents = JSON.parse(decompressed.toString());
  }
  allEvents.push(...events);

  const raw = JSON.stringify(allEvents);
  const compressed = await gzipAsync(Buffer.from(raw));

  await storage.put(storage_key, compressed);

  recordingSizeBytes.observe(compressed.length);

  // Update metadata
  await db.query(
    `UPDATE session_recordings
     SET event_count = $1, compressed_size = $2, raw_size = $3
     WHERE session_id = $4 AND status = 'recording'`,
    [allEvents.length, compressed.length, Buffer.byteLength(raw), sessionId]
  );

  logger.debug({
    sessionId,
    flushed: events.length,
    total: allEvents.length,
    compressedSize: compressed.length,
  }, 'recording events flushed to storage');
}

// ─── Finalize recording ──────────────────────────────────────────────────────

async function finalizeRecording(sessionId) {
  try {
    // Flush remaining buffered events
    await flushBuffer(sessionId);

    // Clean up the buffer from cache
    await cache.del(BUFFER_KEY(sessionId));

    // Calculate duration from session timestamps
    const session = await db.query(
      `SELECT customer_joined_at, ended_at FROM sessions WHERE id = $1`,
      [sessionId]
    );
    let durationMs = null;
    if (session.rows.length && session.rows[0].customer_joined_at) {
      const start = new Date(session.rows[0].customer_joined_at);
      const end = session.rows[0].ended_at ? new Date(session.rows[0].ended_at) : new Date();
      durationMs = Math.max(0, end - start);
    }

    // Mark recording as complete
    await db.query(
      `UPDATE session_recordings
       SET status = 'complete', completed_at = NOW(), duration_ms = $1
       WHERE session_id = $2 AND status = 'recording'`,
      [durationMs, sessionId]
    );

    logger.info({ sessionId, durationMs }, 'recording finalized');
  } catch (err) {
    // Mark as failed but don't throw — session end must not be blocked
    logger.warn({ err, sessionId }, 'recording.finalizeRecording failed (non-fatal)');
    try {
      await db.query(
        `UPDATE session_recordings SET status = 'failed' WHERE session_id = $1 AND status = 'recording'`,
        [sessionId]
      );
    } catch { /* truly non-fatal */ }
  }
}

// ─── Query recordings ────────────────────────────────────────────────────────

async function getRecordingMeta(sessionId, tenantId) {
  const result = await db.query(
    `SELECT * FROM session_recordings WHERE session_id = $1 AND tenant_id = $2`,
    [sessionId, tenantId]
  );
  return result.rows[0] || null;
}

async function listRecordings(tenantId, { limit = 50, offset = 0 } = {}) {
  const result = await db.query(
    `SELECT id, session_id, storage_key, event_count, duration_ms,
            compressed_size, raw_size, status, started_at, completed_at
     FROM session_recordings
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [tenantId, limit, offset]
  );
  return result.rows;
}

async function getRecordingData(sessionId, tenantId) {
  const meta = await getRecordingMeta(sessionId, tenantId);
  if (!meta || !meta.storage_key) return null;

  const compressed = await storage.get(meta.storage_key);
  if (!compressed) return null;

  const decompressed = await gunzipAsync(compressed);
  return {
    meta,
    events: JSON.parse(decompressed.toString()),
  };
}

export {
  isEnabled,
  startRecording,
  bufferEvents,
  flushBuffer,
  finalizeRecording,
  getRecordingMeta,
  listRecordings,
  getRecordingData,
};
