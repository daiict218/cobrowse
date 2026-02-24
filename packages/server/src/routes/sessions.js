import * as sessionService from '../services/session.js';
import { authenticateSecret } from '../middleware/auth.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Session routes — agent-facing.
 * All endpoints require a secret API key (cb_sk_...).
 *
 * POST   /api/v1/sessions               Create a new session
 * GET    /api/v1/sessions/:id           Get session status
 * DELETE /api/v1/sessions/:id           End a session
 */
async function sessionsRoutes(fastify) {
  // ─── Create session ──────────────────────────────────────────────────────────
  fastify.post('/', {
    preHandler: authenticateSecret,
    schema: {
      body: {
        type: 'object',
        required: ['agentId', 'customerId'],
        properties: {
          agentId:    { type: 'string', minLength: 1, maxLength: 128 },
          customerId: { type: 'string', minLength: 1, maxLength: 128 },
          channelRef: { type: 'string', maxLength: 256 }, // CRM conversation ID (optional)
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { agentId, customerId, channelRef } = request.body;
    const { id: tenantId } = request.tenant;

    // Build the base URL so the session service can construct the invite link
    const serverBaseUrl = `${request.protocol}://${request.hostname}`;

    const { session, inviteUrl } = await sessionService.createSession({
      tenantId,
      agentId,
      customerId,
      channelRef,
      serverBaseUrl,
    });

    reply.code(201).send({
      sessionId: session.id,
      tenantId:  session.tenant_id,
      status:    session.status,
      inviteUrl,
      createdAt: session.created_at,
    });
  });

  // ─── Get session ─────────────────────────────────────────────────────────────
  fastify.get('/:id', {
    preHandler: authenticateSecret,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    const session = await sessionService.getSession(request.params.id, request.tenant.id);
    reply.send({
      sessionId:         session.id,
      status:            session.status,
      agentId:           session.agent_id,
      customerId:        session.customer_id,
      channelRef:        session.channel_ref,
      endReason:         session.end_reason,
      createdAt:         session.created_at,
      customerJoinedAt:  session.customer_joined_at,
      agentJoinedAt:     session.agent_joined_at,
      endedAt:           session.ended_at,
      urlsVisited:       session.urls_visited,
    });
  });

  // ─── End session ─────────────────────────────────────────────────────────────
  fastify.delete('/:id', {
    preHandler: authenticateSecret,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    },
  }, async (request, reply) => {
    await sessionService.endSession(request.params.id, request.tenant.id, 'agent');
    reply.code(204).send();
  });
}

export default sessionsRoutes;
