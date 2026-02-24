import * as recording from '../services/recording.js';
import { authenticateSecret } from '../middleware/auth.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

/**
 * Recording routes — session recording retrieval for agents / integrations.
 *
 * All endpoints require secret key authentication and check that the
 * tenant has the sessionReplay feature flag enabled.
 *
 * GET  /api/v1/recordings                     List recordings (paginated)
 * GET  /api/v1/recordings/:sessionId/meta     Get recording metadata
 * GET  /api/v1/recordings/:sessionId          Get full recording data
 */

async function recordingsRoutes(fastify) {
  // All routes require secret key
  fastify.addHook('preHandler', authenticateSecret);

  // Check feature flag on every request
  fastify.addHook('preHandler', async (request) => {
    const enabled = await recording.isEnabled(request.tenant.id);
    if (!enabled) {
      throw new ForbiddenError('Session recording is not enabled for this tenant');
    }
  });

  // ─── List recordings ──────────────────────────────────────────────────────

  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit:  { type: 'string', pattern: '^\\d{1,3}$', default: '50' },
          offset: { type: 'string', pattern: '^\\d{1,7}$', default: '0' },
        },
      },
    },
  }, async (request, reply) => {
    const limit = Math.min(parseInt(request.query.limit, 10) || 50, 100);
    const offset = parseInt(request.query.offset, 10) || 0;

    const recordings = await recording.listRecordings(request.tenant.id, { limit, offset });
    reply.send({ recordings, limit, offset });
  });

  // ─── Get recording metadata ───────────────────────────────────────────────

  fastify.get('/:sessionId/meta', {
    schema: {
      params: {
        type: 'object',
        properties: { sessionId: { type: 'string', format: 'uuid' } },
        required: ['sessionId'],
      },
    },
  }, async (request, reply) => {
    const meta = await recording.getRecordingMeta(request.params.sessionId, request.tenant.id);
    if (!meta) throw new NotFoundError('Recording');
    reply.send({ recording: meta });
  });

  // ─── Get full recording data ──────────────────────────────────────────────

  fastify.get('/:sessionId', {
    schema: {
      params: {
        type: 'object',
        properties: { sessionId: { type: 'string', format: 'uuid' } },
        required: ['sessionId'],
      },
    },
  }, async (request, reply) => {
    const data = await recording.getRecordingData(request.params.sessionId, request.tenant.id);
    if (!data) throw new NotFoundError('Recording');
    reply.send(data);
  });
}

export default recordingsRoutes;
