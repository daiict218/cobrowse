import { authenticateSecret } from '../middleware/auth.js';
import { exportTenantEvents } from '../services/audit.js';
import { ValidationError } from '../utils/errors.js';
import { generateCustomerToken, hashApiKey } from '../utils/token.js';
import * as db from '../db/index.js';
import cache from '../cache/index.js';

/**
 * Admin routes — tenant configuration and audit export.
 * All endpoints require a secret API key.
 *
 * GET  /api/v1/admin/masking-rules          Get current masking rules
 * PUT  /api/v1/admin/masking-rules          Update masking rules
 * GET  /api/v1/admin/audit/export           Export audit log as CSV
 * GET  /api/v1/admin/feature-flags          Get feature flags
 *
 * Note: The GET /masking-rules endpoint is also available via the PUBLIC key
 * so the SDK can fetch rules on init. See the public variant below.
 */
async function adminRoutes(fastify) {

  // ─── Masking rules (public read — SDK calls this on init) ────────────────────
  // Registered separately in app.js under /api/v1/public/masking-rules
  fastify.get('/masking-rules', {
    preHandler: authenticateSecret,
  }, async (request, reply) => {
    reply.send({ maskingRules: request.tenant.masking_rules });
  });

  // ─── Update masking rules ────────────────────────────────────────────────────
  fastify.put('/masking-rules', {
    preHandler: authenticateSecret,
    schema: {
      body: {
        type: 'object',
        properties: {
          selectors: {
            type: 'array',
            items: { type: 'string' },
            description: 'CSS selectors for inputs that should be masked',
          },
          maskTypes: {
            type: 'array',
            items: { type: 'string', enum: ['password', 'tel', 'email', 'number', 'text'] },
            description: 'Input type values that should be masked by default',
          },
          patterns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Regex patterns — matching text content will be replaced',
          },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id: tenantId, masking_rules: current } = request.tenant;

    // Validate regex patterns before persisting — reject invalid or catastrophic patterns
    if (request.body.patterns) {
      for (const patternStr of request.body.patterns) {
        try {
          // eslint-disable-next-line no-new
          new RegExp(patternStr, 'g');
        } catch (err) {
          throw new ValidationError(`Invalid regex pattern "${patternStr}": ${err.message}`);
        }
        // Guard against obvious ReDoS — reject nested quantifiers like (a+)+
        if (/(\+|\*|\{)\s*\)(\+|\*|\{)/.test(patternStr)) {
          throw new ValidationError(`Potentially catastrophic regex pattern rejected: "${patternStr}"`);
        }
      }
    }

    const updated = { ...current, ...request.body };

    await db.query(
      `UPDATE tenants SET masking_rules = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(updated), tenantId]
    );

    reply.send({ maskingRules: updated });
  });

  // ─── Audit export ─────────────────────────────────────────────────────────────
  fastify.get('/audit/export', {
    preHandler: authenticateSecret,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          from:  { type: 'string', format: 'date-time' },
          to:    { type: 'string', format: 'date-time' },
          limit: { type: 'integer', minimum: 1, maximum: 10000, default: 5000 },
        },
      },
    },
  }, async (request, reply) => {
    const from  = request.query.from ? new Date(request.query.from) : new Date(0);
    const to    = request.query.to   ? new Date(request.query.to)   : new Date();
    const limit = request.query.limit ?? 5000;

    const rows = await exportTenantEvents(request.tenant.id, from, to, limit);

    if (!rows.length) {
      reply.code(204).send();
      return;
    }

    // Serialize to CSV
    const headers = [
      'session_id', 'event_type', 'actor', 'agent_id', 'customer_id',
      'channel_ref', 'metadata', 'ts',
    ];
    const csvLines = [
      headers.join(','),
      ...rows.map((r) => [
        r.session_id,
        r.event_type,
        r.actor,
        r.agent_id,
        r.customer_id,
        r.channel_ref ?? '',
        JSON.stringify(r.metadata).replace(/,/g, ';'),
        r.ts.toISOString(),
      ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')),
    ];

    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="cobrowse-audit-${Date.now()}.csv"`)
      .send(csvLines.join('\n'));
  });

  // ─── Feature flags (read) ────────────────────────────────────────────────────
  fastify.get('/feature-flags', {
    preHandler: authenticateSecret,
  }, async (request, reply) => {
    reply.send({ featureFlags: request.tenant.feature_flags });
  });
}

/**
 * Public routes — accept the public key so the SDK can call these without
 * exposing the secret key in the browser.
 */
async function publicRoutes(fastify) {
  // ─── Masking rules ───────────────────────────────────────────────────────────
  fastify.get('/masking-rules', async (request, reply) => {
    const publicKey = request.headers['x-cb-public-key'] || request.query.publicKey;
    if (!publicKey) { reply.code(401).send({ error: 'Public key required' }); return; }

    const hash = hashApiKey(publicKey);
    const result = await db.query(
      `SELECT masking_rules FROM tenants WHERE public_key_hash = $1 AND is_active = true`,
      [hash]
    );
    if (!result.rows.length) { reply.code(401).send({ error: 'Invalid public key' }); return; }
    reply.send({ maskingRules: result.rows[0].masking_rules });
  });

  // ─── Pending activation (SDK polls this after init) ──────────────────────────
  // Returns session info for the most recent pending or active session for this
  // customer. The SDK uses this as a reliable fallback when the Ably invite or
  // activate event is missed (timing, connection delay, page load order).
  //
  // For 'pending' sessions: returns { sessionId, status: 'pending' } so the SDK
  // can show the consent overlay even if the Ably invite was missed.
  // For 'active' sessions: returns { sessionId, customerToken, status: 'active' }
  // so the SDK can resume capture.
  fastify.get('/pending-activation', async (request, reply) => {
    const publicKey = request.headers['x-cb-public-key'] || request.query.publicKey;
    if (!publicKey) { reply.code(401).send({ error: 'Public key required' }); return; }

    const { customerId } = request.query;
    if (!customerId) { reply.code(400).send({ error: 'customerId required' }); return; }

    const hash = hashApiKey(publicKey);
    const tenantResult = await db.query(
      `SELECT id FROM tenants WHERE public_key_hash = $1 AND is_active = true`,
      [hash]
    );
    if (!tenantResult.rows.length) { reply.code(401).send({ error: 'Invalid public key' }); return; }

    const tenantId = tenantResult.rows[0].id;

    // Find the most recent pending or active session for this customer.
    // Pending sessions older than 10 minutes are stale (agent likely moved on).
    // Active sessions older than 2 hours are beyond max duration.
    const sessionResult = await db.query(
      `SELECT id, status, agent_id FROM sessions
       WHERE tenant_id = $1 AND customer_id = $2
         AND (
           (status = 'pending' AND created_at > NOW() - INTERVAL '10 minutes')
           OR
           (status = 'active' AND created_at > NOW() - INTERVAL '2 hours')
         )
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, customerId]
    );

    if (!sessionResult.rows.length) {
      return reply.send({ sessionId: null });
    }

    const { id: sessionId, status, agent_id: agentId } = sessionResult.rows[0];

    if (status === 'active') {
      // Cache the token per session so we don't generate fresh tokens on every poll.
      // A fresh token on every request is a session-fixation risk.
      const tokenCacheKey = `poll_token:${sessionId}:${customerId}`;
      let customerToken = await cache.get(tokenCacheKey);
      if (!customerToken) {
        customerToken = generateCustomerToken(sessionId, customerId, tenantId);
        await cache.set(tokenCacheKey, customerToken, 600); // 10 min TTL
      }
      reply.send({ sessionId, customerToken, status: 'active' });
    } else {
      // Pending — SDK should show consent overlay
      reply.send({
        sessionId,
        status: 'pending',
        agentId,
        inviteUrl: `${request.protocol}://${request.hostname}/consent/${sessionId}`,
      });
    }
  });
}

export { adminRoutes, publicRoutes };
