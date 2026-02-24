import * as db from '../db/index.js';
import logger from '../utils/logger.js';

/**
 * Audit service — writes immutable event records to session_events.
 *
 * All co-browse actions that must be traceable for compliance flow through here.
 * The table is append-only by convention (no UPDATE/DELETE in application code).
 *
 * Event vocabulary:
 *   session.created       session.ended         session.idle_warned
 *   customer.invited      customer.consented     customer.declined
 *   customer.joined       agent.joined
 *   session.url_changed   agent.pointer_used
 */

/**
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.tenantId
 * @param {string} params.eventType
 * @param {string} [params.actor]    — 'agent' | 'customer' | 'system'
 * @param {object} [params.metadata]
 */
async function logEvent({ sessionId, tenantId, eventType, actor = 'system', metadata = {} }) {
  try {
    await db.query(
      `INSERT INTO session_events (session_id, tenant_id, event_type, actor, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, tenantId, eventType, actor, metadata]
    );
  } catch (err) {
    // Audit failures must never crash the main flow — log and move on.
    // In production, consider a dead-letter queue for failed audit writes.
    logger.error({ err, sessionId, eventType }, 'audit log write failed');
  }
}

/**
 * Fetch all events for a session (used by admin export and internal tools).
 */
async function getSessionEvents(sessionId, tenantId) {
  const result = await db.query(
    `SELECT id, event_type, actor, metadata, ts
     FROM session_events
     WHERE session_id = $1 AND tenant_id = $2
     ORDER BY ts ASC`,
    [sessionId, tenantId]
  );
  return result.rows;
}

/**
 * Export all events for a tenant within a date range as an array of rows.
 * The route layer converts this to CSV.
 *
 * @param {string} tenantId
 * @param {Date}   from
 * @param {Date}   to
 * @param {number} [limit=10000]
 */
async function exportTenantEvents(tenantId, from, to, limit = 10_000) {
  const result = await db.query(
    `SELECT
       e.session_id,
       e.event_type,
       e.actor,
       e.metadata,
       e.ts,
       s.agent_id,
       s.customer_id,
       s.channel_ref
     FROM session_events e
     JOIN sessions s ON s.id = e.session_id
     WHERE e.tenant_id = $1
       AND e.ts >= $2
       AND e.ts <= $3
     ORDER BY e.ts DESC
     LIMIT $4`,
    [tenantId, from, to, limit]
  );
  return result.rows;
}

export { logEvent, getSessionEvents, exportTenantEvents };
