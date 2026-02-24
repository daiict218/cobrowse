import * as db from '../db/index.js';
import cache from '../cache/index.js';
import * as ablyService from './ably.js';
import * as audit from './audit.js';
import * as timers from './timers.js';
import { generateCustomerToken } from '../utils/token.js';
import { NotFoundError, ConflictError, ForbiddenError } from '../utils/errors.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import {
  activeSessions,
  sessionLifecycleTotal,
  sessionEndReasonsTotal,
} from '../utils/metrics.js';

/**
 * Session service — owns the lifecycle of every co-browse session.
 *
 * State machine:
 *   [agent creates]  → pending
 *   [customer consents] → active
 *   [any party ends / timeout] → ended
 *
 * Idle timeout and max-duration enforcement are handled by the timers module
 * (timers.js). CACHE_DRIVER=memory uses in-process setTimeout;
 * CACHE_DRIVER=redis uses BullMQ delayed jobs (distributed, survives restarts).
 */

const ACTIVE_SESSION_KEY = (tenantId, agentId) => `active:${tenantId}:${agentId}`;
const SNAPSHOT_KEY       = (sessionId) => `snapshot:${sessionId}`;

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Agent starts a new co-browse session.
 * Enforces: one active session per agent per tenant.
 *
 * @returns {{ session, customerToken, inviteUrl }}
 */
async function createSession({ tenantId, agentId, customerId, channelRef, serverBaseUrl }) {
  // Auto-end any existing session for this agent (stale pending/active sessions)
  const activeSessionId = await cache.get(ACTIVE_SESSION_KEY(tenantId, agentId));
  if (activeSessionId) {
    logger.info({ sessionId: activeSessionId, agentId }, 'auto-ending previous session for agent');
    await endSession(activeSessionId, tenantId, 'agent_new_session');
  }

  // Also end any stale pending/active sessions for this customer to prevent
  // the SDK from picking up an old session via polling.
  const staleCustomerSessions = await db.query(
    `SELECT id FROM sessions
     WHERE tenant_id = $1 AND customer_id = $2 AND status IN ('pending', 'active')`,
    [tenantId, customerId]
  );
  for (const row of staleCustomerSessions.rows) {
    logger.info({ sessionId: row.id, customerId }, 'auto-ending stale customer session');
    await endSession(row.id, tenantId, 'superseded');
  }

  const result = await db.query(
    `INSERT INTO sessions (tenant_id, agent_id, customer_id, channel_ref, invite_sent_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING *`,
    [tenantId, agentId, customerId, channelRef ?? null]
  );
  const session = result.rows[0];

  await audit.logEvent({
    sessionId: session.id,
    tenantId,
    eventType: 'session.created',
    actor: 'agent',
    metadata: { agentId, customerId, channelRef },
  });

  // Publish invite to the customer's Ably invite channel
  await ablyService.publishInvite(tenantId, customerId, {
    sessionId: session.id,
    agentId,
    inviteUrl: `${serverBaseUrl}/consent/${session.id}`,
    expiresInMinutes: 30,
  });

  await audit.logEvent({
    sessionId: session.id,
    tenantId,
    eventType: 'customer.invited',
    actor: 'system',
    metadata: { customerId },
  });

  // Track the active session for this agent
  await cache.set(
    ACTIVE_SESSION_KEY(tenantId, agentId),
    session.id,
    config.session.maxDurationMinutes * 60
  );

  // Start the overall session max-duration timer
  timers.scheduleMaxDuration(session.id, tenantId);

  const inviteUrl = `${serverBaseUrl}/consent/${session.id}`;

  sessionLifecycleTotal.inc({ event: 'created' });
  activeSessions.inc({ status: 'pending' });

  logger.info({ sessionId: session.id, tenantId, agentId, customerId }, 'session created');

  return {
    session,
    inviteUrl,
  };
}

// ─── Get ──────────────────────────────────────────────────────────────────────

async function getSession(sessionId, tenantId) {
  const result = await db.query(
    `SELECT * FROM sessions WHERE id = $1 AND tenant_id = $2`,
    [sessionId, tenantId]
  );
  if (!result.rows.length) throw new NotFoundError('Session');
  return result.rows[0];
}

// ─── Customer Consent ─────────────────────────────────────────────────────────

/**
 * Customer approves the co-browse invite.
 * Transitions session pending → active and issues a customer token.
 *
 * @returns {{ customerToken, session }}
 */
async function recordConsent({ sessionId, customerId }) {
  // Load session without tenant filter — we validate customerId instead
  const result = await db.query(
    `SELECT * FROM sessions WHERE id = $1`,
    [sessionId]
  );
  if (!result.rows.length) throw new NotFoundError('Session');

  const session = result.rows[0];

  if (session.status === 'ended') {
    throw new ForbiddenError('This session has already ended');
  }
  if (session.customer_id !== customerId) {
    throw new ForbiddenError('Customer ID does not match this session');
  }
  if (session.status === 'active') {
    // Idempotent — return a fresh token if customer reconnects
    const customerToken = generateCustomerToken(sessionId, customerId, session.tenant_id);
    return { customerToken, session };
  }

  // Atomic transition to active — WHERE clause prevents double-consent race condition.
  // If two concurrent requests both pass the status checks above, only one UPDATE
  // will match the WHERE condition (status = 'pending'). The other gets rowCount 0.
  const updated = await db.query(
    `UPDATE sessions SET status = 'active', customer_joined_at = NOW()
     WHERE id = $1 AND status = 'pending' AND customer_id = $2
     RETURNING *`,
    [sessionId, customerId]
  );

  if (!updated.rowCount) {
    // Another request won the race — re-read and return idempotently
    const recheck = await db.query(`SELECT * FROM sessions WHERE id = $1`, [sessionId]);
    if (recheck.rows[0]?.status === 'active') {
      const customerToken = generateCustomerToken(sessionId, customerId, session.tenant_id);
      return { customerToken, session: recheck.rows[0] };
    }
    throw new ForbiddenError('Session is no longer available for consent');
  }

  await audit.logEvent({
    sessionId,
    tenantId: session.tenant_id,
    eventType: 'customer.consented',
    actor: 'customer',
    metadata: { customerId },
  });

  const customerToken = generateCustomerToken(sessionId, customerId, session.tenant_id);

  // Notify the agent panel
  await ablyService.publishSysEvent(session.tenant_id, sessionId, 'customer.joined', {
    customerId,
  });

  // Push the customerToken directly to the customer's Ably invite channel so the
  // SDK activates immediately — works cross-origin, no localStorage dependency.
  await ablyService.publishConsentApproved(session.tenant_id, customerId, sessionId, customerToken);

  // Start the idle timer now that both parties are expected to be active
  timers.resetIdleTimer(sessionId, session.tenant_id);

  sessionLifecycleTotal.inc({ event: 'consented' });
  activeSessions.dec({ status: 'pending' });
  activeSessions.inc({ status: 'active' });

  logger.info({ sessionId, customerId }, 'customer consented — session active');

  return { customerToken, session: updated.rows[0] };
}

// ─── Customer Decline ─────────────────────────────────────────────────────────

async function recordDecline({ sessionId, customerId }) {
  const result = await db.query(`SELECT * FROM sessions WHERE id = $1`, [sessionId]);
  if (!result.rows.length) throw new NotFoundError('Session');

  const session = result.rows[0];
  if (session.customer_id !== customerId) throw new ForbiddenError('Customer ID mismatch');

  sessionLifecycleTotal.inc({ event: 'declined' });

  await endSession(sessionId, session.tenant_id, 'customer_declined');

  await audit.logEvent({
    sessionId,
    tenantId: session.tenant_id,
    eventType: 'customer.declined',
    actor: 'customer',
    metadata: { customerId },
  });
}

// ─── Agent Joined ─────────────────────────────────────────────────────────────

async function recordAgentJoined(sessionId, tenantId, agentId) {
  await db.query(
    `UPDATE sessions SET agent_joined_at = NOW() WHERE id = $1 AND tenant_id = $2`,
    [sessionId, tenantId]
  );
  await audit.logEvent({
    sessionId,
    tenantId,
    eventType: 'agent.joined',
    actor: 'agent',
    metadata: { agentId },
  });
}

// ─── Activity Ping (idle timer reset) ─────────────────────────────────────────

/**
 * Called by the server whenever a DOM event or control event arrives.
 * Resets the idle countdown for this session.
 */
function touchSession(sessionId, tenantId) {
  timers.touchSession(sessionId, tenantId);
}

// ─── URL Change Tracking ──────────────────────────────────────────────────────

async function recordUrlChange(sessionId, tenantId, url) {
  await db.query(
    `UPDATE sessions
     SET urls_visited = array_append(urls_visited, $1)
     WHERE id = $2 AND tenant_id = $3`,
    [url, sessionId, tenantId]
  );
  await audit.logEvent({
    sessionId,
    tenantId,
    eventType: 'session.url_changed',
    actor: 'customer',
    metadata: { url },
  });
}

// ─── Snapshot Store / Fetch ───────────────────────────────────────────────────

async function storeSnapshot(sessionId, snapshot) {
  await cache.set(
    SNAPSHOT_KEY(sessionId),
    snapshot,
    config.session.snapshotTtlSeconds
  );
}

async function fetchSnapshot(sessionId) {
  return cache.get(SNAPSHOT_KEY(sessionId));
}

// ─── End Session ──────────────────────────────────────────────────────────────

/**
 * Terminates a session. Idempotent — safe to call multiple times.
 * reason: 'agent' | 'customer' | 'idle_timeout' | 'max_duration' | 'error'
 */
async function endSession(sessionId, tenantId, reason = 'agent') {
  const result = await db.query(
    `UPDATE sessions
     SET status = 'ended', ended_at = NOW(), end_reason = $1
     WHERE id = $2 AND tenant_id = $3 AND status != 'ended'
     RETURNING *`,
    [reason, sessionId, tenantId]
  );

  if (!result.rowCount) {
    // Already ended — idempotent, just return
    logger.debug({ sessionId }, 'endSession called on already-ended session');
    return;
  }

  const session = result.rows[0];

  sessionLifecycleTotal.inc({ event: 'ended' });
  sessionEndReasonsTotal.inc({ reason });
  // Decrement the appropriate gauge — if customer had joined it was active, otherwise pending
  if (session.customer_joined_at) {
    activeSessions.dec({ status: 'active' });
  } else {
    activeSessions.dec({ status: 'pending' });
  }

  // Clear agent's active session lock
  await cache.del(ACTIVE_SESSION_KEY(tenantId, session.agent_id));
  await cache.del(SNAPSHOT_KEY(sessionId));

  // Cancel timers
  timers.clearTimers(sessionId);

  // Notify both parties
  await ablyService.publishSysEvent(tenantId, sessionId, 'session.ended', { reason });

  await audit.logEvent({
    sessionId,
    tenantId,
    eventType: 'session.ended',
    actor: reason === 'agent' ? 'agent' : reason === 'customer_declined' ? 'customer' : 'system',
    metadata: { reason, agentId: session.agent_id, customerId: session.customer_id },
  });

  logger.info({ sessionId, tenantId, reason }, 'session ended');
}

// ─── DOM Event Buffer (HTTP relay for when Ably is blocked) ──────────────────
// Stores incremental DOM events in cache so the agent can poll via HTTP.
// Keeps the last MAX_BUFFERED_EVENTS per session to bound memory usage.

const DOM_EVENTS_KEY = (sessionId) => `dom_events:${sessionId}`;
const MAX_BUFFERED_EVENTS = 2000;

async function bufferDomEvents(sessionId, events) {
  const key = DOM_EVENTS_KEY(sessionId);
  let buffer = await cache.get(key);
  if (!buffer) buffer = [];

  for (const event of events) {
    buffer.push(event);
  }

  // Trim old events to bound memory
  if (buffer.length > MAX_BUFFERED_EVENTS) {
    buffer = buffer.slice(buffer.length - MAX_BUFFERED_EVENTS);
  }

  await cache.set(key, buffer, config.session.maxDurationMinutes * 60);
}

async function getDomEvents(sessionId, since) {
  const key = DOM_EVENTS_KEY(sessionId);
  const buffer = await cache.get(key);
  if (!buffer || !buffer.length) return { events: [], nextSeq: 0 };

  const startIndex = Math.max(0, Math.min(since, buffer.length));
  const events = buffer.slice(startIndex);
  return { events, nextSeq: buffer.length };
}

export {
  createSession,
  getSession,
  recordConsent,
  recordDecline,
  recordAgentJoined,
  touchSession,
  recordUrlChange,
  storeSnapshot,
  fetchSnapshot,
  bufferDomEvents,
  getDomEvents,
  endSession,
};
