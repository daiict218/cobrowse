'use strict';

const db = require('../db');
const cache = require('../cache');
const ablyService = require('./ably');
const audit = require('./audit');
const { generateCustomerToken } = require('../utils/token');
const { NotFoundError, ConflictError, ForbiddenError } = require('../utils/errors');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Session service — owns the lifecycle of every co-browse session.
 *
 * State machine:
 *   [agent creates]  → pending
 *   [customer consents] → active
 *   [any party ends / timeout] → ended
 *
 * Idle timeout and max-duration enforcement are handled by per-session timers
 * stored in the cache. In production with multiple server instances, move
 * these timers to a Redis-backed job queue (e.g. BullMQ).
 */

const ACTIVE_SESSION_KEY = (tenantId, agentId) => `active:${tenantId}:${agentId}`;
const IDLE_TIMER_KEY     = (sessionId) => `idle_timer:${sessionId}`;
const SNAPSHOT_KEY       = (sessionId) => `snapshot:${sessionId}`;

// In-process timer handles (session timers). Not persisted across restarts.
// Production: replace with a distributed scheduler.
const _timers = new Map();

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Agent starts a new co-browse session.
 * Enforces: one active session per agent per tenant.
 *
 * @returns {{ session, customerToken, inviteUrl }}
 */
async function createSession({ tenantId, agentId, customerId, channelRef, serverBaseUrl }) {
  // Enforce one active session per agent
  const activeSessionId = await cache.get(ACTIVE_SESSION_KEY(tenantId, agentId));
  if (activeSessionId) {
    throw new ConflictError(
      `Agent ${agentId} already has an active session (${activeSessionId}). End it before starting a new one.`
    );
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
  _scheduleMaxDuration(session.id, tenantId);

  const inviteUrl = `${serverBaseUrl}/consent/${session.id}`;

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

  // Transition to active
  const updated = await db.query(
    `UPDATE sessions SET status = 'active', customer_joined_at = NOW()
     WHERE id = $1 RETURNING *`,
    [sessionId]
  );

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
  _resetIdleTimer(sessionId, session.tenant_id);

  logger.info({ sessionId, customerId }, 'customer consented — session active');

  return { customerToken, session: updated.rows[0] };
}

// ─── Customer Decline ─────────────────────────────────────────────────────────

async function recordDecline({ sessionId, customerId }) {
  const result = await db.query(`SELECT * FROM sessions WHERE id = $1`, [sessionId]);
  if (!result.rows.length) throw new NotFoundError('Session');

  const session = result.rows[0];
  if (session.customer_id !== customerId) throw new ForbiddenError('Customer ID mismatch');

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
  _resetIdleTimer(sessionId, tenantId);
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

  // Clear agent's active session lock
  await cache.del(ACTIVE_SESSION_KEY(tenantId, session.agent_id));
  await cache.del(SNAPSHOT_KEY(sessionId));

  // Cancel timers
  _clearTimers(sessionId);

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

// ─── Timers (per-process, replace with distributed scheduler in production) ───

function _scheduleMaxDuration(sessionId, tenantId) {
  const ms = config.session.maxDurationMinutes * 60 * 1000;
  const timer = setTimeout(() => {
    endSession(sessionId, tenantId, 'max_duration').catch((err) =>
      logger.error({ err, sessionId }, 'max duration end failed')
    );
  }, ms);
  timer.unref();
  _timers.set(`max:${sessionId}`, timer);
}

function _resetIdleTimer(sessionId, tenantId) {
  // Clear existing idle timer
  const existingIdle = _timers.get(`idle:${sessionId}`);
  if (existingIdle) clearTimeout(existingIdle);

  const warnMs  = (config.session.idleTimeoutMinutes * 60 - 60) * 1000; // 1 min warning
  const endMs   = config.session.idleTimeoutMinutes * 60 * 1000;

  // Warn at (timeout - 1 minute)
  const warnTimer = setTimeout(async () => {
    await ablyService.publishSysEvent(tenantId, sessionId, 'session.idle_warned', {
      secondsRemaining: 60,
    });
    await audit.logEvent({ sessionId, tenantId, eventType: 'session.idle_warned' });
  }, warnMs > 0 ? warnMs : 0);
  warnTimer.unref();

  // End at timeout
  const idleTimer = setTimeout(() => {
    endSession(sessionId, tenantId, 'idle_timeout').catch((err) =>
      logger.error({ err, sessionId }, 'idle timeout end failed')
    );
  }, endMs);
  idleTimer.unref();

  _timers.set(`idle:${sessionId}`, idleTimer);
  _timers.set(`warn:${sessionId}`, warnTimer);
}

function _clearTimers(sessionId) {
  for (const key of [`idle:${sessionId}`, `warn:${sessionId}`, `max:${sessionId}`]) {
    const t = _timers.get(key);
    if (t) { clearTimeout(t); _timers.delete(key); }
  }
}

module.exports = {
  createSession,
  getSession,
  recordConsent,
  recordDecline,
  recordAgentJoined,
  touchSession,
  recordUrlChange,
  storeSnapshot,
  fetchSnapshot,
  endSession,
};
