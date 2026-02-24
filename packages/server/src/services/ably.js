'use strict';

const Ably = require('ably');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Ably service — wraps the server-side Ably REST client.
 *
 * Channel naming convention (tenant-scoped to prevent cross-tenant leakage):
 *
 *   invite:{tenantId}:{customerId}          → SDK listens for session invites
 *   session:{tenantId}:{sessionId}:dom      → customer publishes DOM events
 *   session:{tenantId}:{sessionId}:ctrl     → agent publishes pointer/control events
 *   session:{tenantId}:{sessionId}:sys      → server publishes lifecycle events
 *
 * Token capability scoping:
 *   invite role  → subscribe only on invite:{tenantId}:{customerId}
 *   customer role→ publish on :dom, subscribe on :ctrl + :sys
 *   agent role   → subscribe on :dom, publish on :ctrl, subscribe on :sys
 *   server       → full key (used by this service only, never sent to clients)
 */

const rest = new Ably.Rest({ key: config.ably.apiKey });

const CHANNEL = {
  invite: (tenantId, customerId) => `invite:${tenantId}:${customerId}`,
  dom:    (tenantId, sessionId) => `session:${tenantId}:${sessionId}:dom`,
  ctrl:   (tenantId, sessionId) => `session:${tenantId}:${sessionId}:ctrl`,
  sys:    (tenantId, sessionId) => `session:${tenantId}:${sessionId}:sys`,
};

/**
 * Create a short-lived Ably token request for a specific participant role.
 *
 * @param {'invite'|'customer'|'agent'} role
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.sessionId   — required for customer/agent roles
 * @param {string} params.customerId  — required for invite role
 * @param {string} params.clientId    — unique identifier for this connection
 * @returns {Promise<object>}  Ably TokenRequest (sent to client, exchanged for token)
 */
async function createTokenRequest(role, { tenantId, sessionId, customerId, clientId }) {
  let capability = {};
  let ttl = 24 * 60 * 60 * 1000; // 24h default — actual session lifetime enforced by server

  switch (role) {
    case 'invite':
      // SDK connects once and subscribes to its customer-specific invite channel.
      // No publish rights — the server is the only publisher to this channel.
      capability = {
        [CHANNEL.invite(tenantId, customerId)]: ['subscribe'],
      };
      break;

    case 'customer':
      // Customer can publish DOM events and subscribe to control + system events.
      // They cannot publish to ctrl (agent-only) or read other sessions.
      capability = {
        [CHANNEL.dom(tenantId, sessionId)]:  ['publish'],
        [CHANNEL.ctrl(tenantId, sessionId)]: ['subscribe'],
        [CHANNEL.sys(tenantId, sessionId)]:  ['subscribe'],
      };
      ttl = config.session.maxDurationMinutes * 60 * 1000;
      break;

    case 'agent':
      // Agent subscribes to DOM events and publishes pointer/control events.
      capability = {
        [CHANNEL.dom(tenantId, sessionId)]:  ['subscribe'],
        [CHANNEL.ctrl(tenantId, sessionId)]: ['publish'],
        [CHANNEL.sys(tenantId, sessionId)]:  ['subscribe'],
      };
      ttl = config.session.maxDurationMinutes * 60 * 1000;
      break;

    default:
      throw new Error(`Unknown Ably token role: ${role}`);
  }

  const tokenRequest = await rest.auth.createTokenRequest({
    clientId: clientId || `${role}_${Date.now()}`,
    capability,
    ttl,
  });

  return tokenRequest;
}

/**
 * Publish a session invite to the customer's invite channel.
 * Called by the session service when an agent starts a session.
 */
async function publishInvite(tenantId, customerId, payload) {
  const channel = rest.channels.get(CHANNEL.invite(tenantId, customerId));
  await channel.publish('invite', payload);
  logger.info({ tenantId, customerId, sessionId: payload.sessionId }, 'invite published to customer');
}

/**
 * Publish a system event to the session sys channel.
 * Used for: session.ended, session.idle_warned, customer.joined
 */
async function publishSysEvent(tenantId, sessionId, eventType, payload = {}) {
  const channel = rest.channels.get(CHANNEL.sys(tenantId, sessionId));
  await channel.publish(eventType, { type: eventType, ...payload });
  logger.debug({ tenantId, sessionId, eventType }, 'sys event published');
}

/**
 * Publish an 'activate' event to the customer's invite channel after consent.
 * The customer SDK listens for this and starts capturing immediately — bypassing
 * the cross-origin localStorage limitation when consent is given on a hosted page.
 */
async function publishConsentApproved(tenantId, customerId, sessionId, customerToken) {
  const channel = rest.channels.get(CHANNEL.invite(tenantId, customerId));
  await channel.publish('activate', { sessionId, customerToken });
  logger.debug({ tenantId, customerId, sessionId }, 'consent activation published to customer');
}

module.exports = { createTokenRequest, publishInvite, publishSysEvent, publishConsentApproved, CHANNEL };
