import * as sessionService from '../services/session.js';
import { authenticateSecret } from '../middleware/auth.js';
import { verifyCustomerToken } from '../utils/token.js';
import { UnauthorizedError } from '../utils/errors.js';

/**
 * DOM Events relay routes — HTTP fallback for when Ably WebSocket is blocked.
 *
 * The customer SDK streams incremental rrweb events via Ably in real-time.
 * When the agent's browser blocks WebSocket connections (e.g. Brave shields),
 * this HTTP relay serves as a fallback:
 *   - Customer SDK POSTs batched events to the server
 *   - Agent polls for new events since a given sequence number
 *
 * POST  /api/v1/dom-events/:sessionId     SDK buffers events (customer auth)
 * GET   /api/v1/dom-events/:sessionId     Agent polls for events (secret key)
 */
async function domEventsRoutes(fastify) {
  // ─── Store DOM events (called by customer SDK alongside Ably) ──────────────
  fastify.post('/:sessionId', {
    config: {
      rateLimit: { max: 3000, timeWindow: '1 minute' },
    },
    schema: {
      params: {
        type: 'object',
        properties: { sessionId: { type: 'string', format: 'uuid' } },
        required: ['sessionId'],
      },
      body: {
        type: 'object',
        required: ['events', 'customerToken'],
        properties: {
          events:        { type: 'array' },
          customerToken: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { sessionId } = request.params;
    const { events, customerToken } = request.body;

    // Verify customer token
    let tokenPayload;
    try {
      tokenPayload = verifyCustomerToken(customerToken);
    } catch {
      throw new UnauthorizedError('Invalid or expired authentication token');
    }

    if (tokenPayload.sessionId !== sessionId) {
      throw new UnauthorizedError('Token does not match session');
    }

    if (events.length > 0) {
      await sessionService.bufferDomEvents(sessionId, events, tokenPayload.tenantId);
      // Reset idle timer on activity
      sessionService.touchSession(sessionId, tokenPayload.tenantId);
    }

    reply.code(200).send({ buffered: events.length });
  });

  // ─── Fetch DOM events (called by agent panel when Ably is unavailable) ─────
  fastify.get('/:sessionId', {
    preHandler: authenticateSecret,
    config: {
      rateLimit: { max: 3000, timeWindow: '1 minute' },
    },
    schema: {
      params: {
        type: 'object',
        properties: { sessionId: { type: 'string', format: 'uuid' } },
        required: ['sessionId'],
      },
      querystring: {
        type: 'object',
        properties: {
          since: { type: 'string', pattern: '^\\d{1,7}$', default: '0' },
        },
      },
    },
  }, async (request, reply) => {
    const { sessionId } = request.params;
    const since = parseInt(request.query.since, 10) || 0;

    // Verify tenant owns this session
    await sessionService.getSession(sessionId, request.tenant.id);

    const { events, nextSeq } = await sessionService.getDomEvents(sessionId, since);
    reply.send({ events, nextSeq });
  });
}

export default domEventsRoutes;
