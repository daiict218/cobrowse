import * as sessionService from '../services/session.js';
import * as ablyService from '../services/ably.js';
import { authenticate, authenticateSecret } from '../middleware/auth.js';
import { verifyCustomerToken } from '../utils/token.js';
import { UnauthorizedError, NotFoundError, ValidationError } from '../utils/errors.js';

/**
 * Snapshot routes — DOM snapshot store and retrieve.
 *
 * The initial rrweb full-page snapshot can be 500KB–1MB, exceeding Ably's
 * per-message limit. We route it through HTTP instead:
 *   - Customer SDK POSTs the snapshot directly to our server
 *   - Agent panel GETs it once on session join, then streams incremental events via Ably
 *
 * POST  /api/v1/snapshots/:sessionId   SDK stores initial snapshot (customer auth)
 * GET   /api/v1/snapshots/:sessionId   Agent fetches snapshot (secret key auth)
 */
async function snapshotsRoutes(fastify) {
  // ─── Store snapshot (called by customer SDK) ─────────────────────────────────
  fastify.post('/:sessionId', {
    config: { rawBody: true },
    schema: {
      params: {
        type: 'object',
        properties: { sessionId: { type: 'string', format: 'uuid' } },
        required: ['sessionId'],
      },
      body: {
        type: 'object',
        required: ['snapshot', 'customerToken'],
        properties: {
          snapshot:      {}, // rrweb events: array [meta, fullSnapshot] or single object
          customerToken: { type: 'string', minLength: 1 },
          url:           { type: 'string', maxLength: 2048 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { sessionId } = request.params;
    const { snapshot, customerToken, url } = request.body;

    // Verify the customer token (HMAC-signed, includes sessionId binding)
    let tokenPayload;
    try {
      tokenPayload = verifyCustomerToken(customerToken);
    } catch (err) {
      throw new UnauthorizedError(`Invalid customer token: ${err.message}`);
    }

    if (tokenPayload.sessionId !== sessionId) {
      throw new UnauthorizedError('Token does not match session');
    }

    // Verify session exists and is active
    const session = await sessionService.getSession(sessionId, tokenPayload.tenantId);
    if (session.status !== 'active') {
      throw new UnauthorizedError('Session is not active');
    }

    // Only store snapshots with real content.
    // URL-change POSTs (from the SDK's _reportUrlChange) send snapshot:{} as a placeholder
    // so we can track navigation without overwriting the real DOM snapshot.
    const isNonEmptySnapshot = Array.isArray(snapshot)
      ? snapshot.length > 0
      : (snapshot && typeof snapshot === 'object' && Object.keys(snapshot).length > 0);

    if (isNonEmptySnapshot) {
      // Detect navigation re-upload (a snapshot already exists for this session)
      const existingSnapshot = await sessionService.fetchSnapshot(sessionId);
      await sessionService.storeSnapshot(sessionId, snapshot);

      if (!existingSnapshot) {
        // Initial snapshot — customer is now fully connected
        await sessionService.recordAgentJoined(sessionId, tokenPayload.tenantId, 'sdk_snapshot');
      } else {
        // Navigation re-snapshot — notify agent to refresh their live view
        ablyService.publishSysEvent(
          tokenPayload.tenantId, sessionId, 'snapshot.updated', { url: url || null }
        ).catch(() => {}); // non-fatal — agent can still use the stale view
      }
    }

    // Always track URL regardless of snapshot content
    if (url) {
      await sessionService.recordUrlChange(sessionId, tokenPayload.tenantId, url);
    }

    reply.code(201).send({ stored: true });
  });

  // ─── Fetch snapshot (called by agent panel) ──────────────────────────────────
  fastify.get('/:sessionId', {
    preHandler: authenticateSecret,
    schema: {
      params: {
        type: 'object',
        properties: { sessionId: { type: 'string', format: 'uuid' } },
        required: ['sessionId'],
      },
    },
  }, async (request, reply) => {
    const { sessionId } = request.params;

    // Verify tenant owns this session
    await sessionService.getSession(sessionId, request.tenant.id);

    const snapshot = await sessionService.fetchSnapshot(sessionId);
    if (!snapshot) throw new NotFoundError('Snapshot not yet available — customer may not have connected');

    reply.send({ snapshot });
  });
}

export default snapshotsRoutes;
