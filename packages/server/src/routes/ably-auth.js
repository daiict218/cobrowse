import * as ablyService from '../services/ably.js';
import * as sessionService from '../services/session.js';
import { authenticate, authenticateSecret, authenticateSecretOrJwt } from '../middleware/auth.js';
import { authenticateJwt } from '../middleware/jwt-auth.js';
import { verifyCustomerToken, hashApiKey } from '../utils/token.js';
import { UnauthorizedError, ValidationError } from '../utils/errors.js';
import * as db from '../db/index.js';

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
        } catch {
          throw new UnauthorizedError('Invalid or expired authentication token');
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
        // Authenticated with secret key or JWT Bearer token.
        if (!sessionId) throw new ValidationError('sessionId required for agent role');

        let tenantId;
        let agentClientId;

        // Try API key first, fall back to JWT
        const apiKey = request.headers['x-api-key'] || request.headers['x-cb-secret-key'];
        if (apiKey && apiKey.startsWith('cb_sk_')) {
          const hash = hashApiKey(apiKey);
          const tenantResult = await db.query(
            `SELECT id, is_active FROM tenants WHERE secret_key_hash = $1`,
            [hash]
          );
          if (!tenantResult.rows.length || !tenantResult.rows[0].is_active) {
            throw new UnauthorizedError('Invalid secret key');
          }
          tenantId = tenantResult.rows[0].id;
        } else {
          // JWT path
          await authenticateJwt(request);
          tenantId = request.tenant.id;
        }

        // Confirm session belongs to this tenant
        const session = await sessionService.getSession(sessionId, tenantId);
        if (session.status === 'ended') {
          throw new UnauthorizedError('Session has ended');
        }

        agentClientId = request.agent?.id || session.agent_id;

        const tokenRequest = await ablyService.createTokenRequest('agent', {
          tenantId,
          sessionId,
          clientId: `agent:${agentClientId}`,
        });

        // Record agent joined if session is active
        if (session.status === 'active') {
          await sessionService.recordAgentJoined(sessionId, tenantId, agentClientId);
        }

        reply.send(tokenRequest);
        break;
      }

      default:
        throw new ValidationError(`Unknown role: ${role}. Valid roles: invite, customer, agent`);
    }
  });
}

export default ablyAuthRoutes;
