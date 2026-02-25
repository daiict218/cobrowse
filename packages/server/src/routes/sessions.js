import * as sessionService from '../services/session.js';
import { authenticateSecretOrJwt } from '../middleware/auth.js';
import { ValidationError } from '../utils/errors.js';

/**
 * Session routes — agent-facing.
 * All endpoints require a secret API key (cb_sk_...) or JWT Bearer token.
 *
 * POST   /api/v1/sessions               Create a new session
 * GET    /api/v1/sessions/:id           Get session status
 * DELETE /api/v1/sessions/:id           End a session
 */
async function sessionsRoutes(fastify) {
  // ─── Create session ──────────────────────────────────────────────────────────
  fastify.post('/', {
    preHandler: authenticateSecretOrJwt,
    schema: {
      body: {
        type: 'object',
        required: ['customerId'],
        properties: {
          agentId:    { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_.@:=-]+$' },
          customerId: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_.@:=-]+$' },
          channelRef: { type: 'string', maxLength: 256 }, // CRM conversation ID (optional)
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    // agentId: JWT sub claim takes priority (prevents impersonation),
    // falls back to body.agentId for API key auth path.
    const agentId = request.agent?.id || request.body.agentId;
    if (!agentId) throw new ValidationError('agentId is required');
    const { customerId, channelRef } = request.body;
    const { id: tenantId } = request.tenant;

    // Build the base URL so the session service can construct the invite link.
    // Use headers.host (includes port) instead of hostname (strips port).
    const serverBaseUrl = `${request.protocol}://${request.headers.host}`;

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
    preHandler: authenticateSecretOrJwt,
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
    preHandler: authenticateSecretOrJwt,
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
