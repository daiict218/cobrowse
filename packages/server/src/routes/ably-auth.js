'use strict';

const ablyService = require('../services/ably');
const sessionService = require('../services/session');
const { authenticate, authenticateSecret } = require('../middleware/auth');
const { verifyCustomerToken } = require('../utils/token');
const { UnauthorizedError, ValidationError } = require('../utils/errors');
const db = require('../db');
const { hashApiKey } = require('../utils/token');

/**
 * Ably token auth endpoint.
 *
 * Clients never hold the Ably master API key. Instead, they call this endpoint
 * to exchange their credential (public key, secret key, or customer token) for
 * a short-lived, scoped Ably TokenRequest. The Ably SDK then exchanges that
 * TokenRequest directly with Ably's servers.
 *
 * GET /api/v1/ably-auth?role=invite&customerId=...   (public key auth)
 * GET /api/v1/ably-auth?role=customer&sessionId=...  (customer token auth)
 * GET /api/v1/ably-auth?role=agent&sessionId=...     (secret key auth)
 */
async function ablyAuthRoutes(fastify) {
  fastify.get('/', async (request, reply) => {
    const { role, sessionId, customerId } = request.query;

    if (!role) throw new ValidationError('role query parameter is required');

    switch (role) {
      case 'invite': {
        // SDK on customer's page subscribes to their invite channel.
        // Authenticated with public key — low-privilege, subscribe-only.
        if (!customerId) throw new ValidationError('customerId required for invite role');

        const publicKey = request.headers['x-cb-public-key'] || request.query.publicKey;
        if (!publicKey) throw new UnauthorizedError('Public key required');

        const hash = hashApiKey(publicKey);
        const result = await db.query(
          `SELECT id, is_active FROM tenants WHERE public_key_hash = $1`,
          [hash]
        );
        if (!result.rows.length || !result.rows[0].is_active) {
          throw new UnauthorizedError('Invalid public key');
        }

        const tenantId = result.rows[0].id;
        const tokenRequest = await ablyService.createTokenRequest('invite', {
          tenantId,
          customerId,
          clientId: `customer:${customerId}`,
        });

        reply.send(tokenRequest);
        break;
      }

      case 'customer': {
        // Customer SDK connects to session channels after consent.
        // Authenticated with the HMAC-signed customer token issued at consent time.
        if (!sessionId) throw new ValidationError('sessionId required for customer role');

        const customerToken = request.headers['x-customer-token'] || request.query.customerToken;
        if (!customerToken) throw new UnauthorizedError('Customer token required');

        let tokenPayload;
        try {
          tokenPayload = verifyCustomerToken(customerToken);
        } catch (err) {
          throw new UnauthorizedError(`Invalid customer token: ${err.message}`);
        }

        if (tokenPayload.sessionId !== sessionId) {
          throw new UnauthorizedError('Token does not match session');
        }

        // Confirm session is still active
        const session = await sessionService.getSession(sessionId, tokenPayload.tenantId);
        if (session.status !== 'active') {
          throw new UnauthorizedError('Session is not active');
        }

        const tokenRequest = await ablyService.createTokenRequest('customer', {
          tenantId: tokenPayload.tenantId,
          sessionId,
          clientId: `customer:${tokenPayload.customerId}`,
        });

        reply.send(tokenRequest);
        break;
      }

      case 'agent': {
        // Agent panel connects to session channels.
        // Authenticated with secret key — high-privilege.
        if (!sessionId) throw new ValidationError('sessionId required for agent role');

        // Inline secret key auth (same logic as authenticateSecret middleware)
        const apiKey = request.headers['x-api-key'] || request.headers['x-cb-secret-key'];
        if (!apiKey || !apiKey.startsWith('cb_sk_')) {
          throw new UnauthorizedError('Secret key required for agent role');
        }

        const hash = hashApiKey(apiKey);
        const tenantResult = await db.query(
          `SELECT id, is_active FROM tenants WHERE secret_key_hash = $1`,
          [hash]
        );
        if (!tenantResult.rows.length || !tenantResult.rows[0].is_active) {
          throw new UnauthorizedError('Invalid secret key');
        }

        const tenantId = tenantResult.rows[0].id;

        // Confirm session belongs to this tenant
        const session = await sessionService.getSession(sessionId, tenantId);
        if (session.status === 'ended') {
          throw new UnauthorizedError('Session has ended');
        }

        const tokenRequest = await ablyService.createTokenRequest('agent', {
          tenantId,
          sessionId,
          clientId: `agent:${session.agent_id}`,
        });

        // Record agent joined if session is active
        if (session.status === 'active') {
          await sessionService.recordAgentJoined(sessionId, tenantId, session.agent_id);
        }

        reply.send(tokenRequest);
        break;
      }

      default:
        throw new ValidationError(`Unknown role: ${role}. Valid roles: invite, customer, agent`);
    }
  });
}

module.exports = ablyAuthRoutes;
