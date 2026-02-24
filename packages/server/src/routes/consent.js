import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sessionService from '../services/session.js';
import { NotFoundError } from '../utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const consentTemplate = fs.readFileSync(
  path.join(__dirname, '../views/consent.html'),
  'utf8'
);

/**
 * Consent routes — customer-facing HTML page and API action.
 *
 * GET  /consent/:sessionId        Renders the consent page
 * POST /consent/:sessionId/approve Customer approves (form submit or fetch)
 * POST /consent/:sessionId/decline Customer declines
 *
 * These are public routes — no API key required.
 * Security: sessionId is a UUID (128-bit random), not guessable.
 * The approve endpoint validates that customerId matches the session record.
 */
async function consentRoutes(fastify) {
  // ─── Consent page ─────────────────────────────────────────────────────────────
  fastify.get('/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;

    // Load session without tenant filter to render the page
    const result = await fastify.db.query(
      `SELECT s.id, s.status, s.customer_id, s.agent_id, t.name AS tenant_name
       FROM sessions s JOIN tenants t ON t.id = s.tenant_id
       WHERE s.id = $1`,
      [sessionId]
    );

    if (!result.rows.length) {
      reply.code(404).type('text/html').send('<h1>Session not found</h1>');
      return;
    }

    const session = result.rows[0];

    if (session.status === 'ended') {
      reply.code(410).type('text/html').send(
        '<h1>This co-browse session has ended.</h1><p>You can close this tab.</p>'
      );
      return;
    }

    // Simple template substitution — no JS framework needed for a server-rendered page
    const html = consentTemplate
      .replaceAll('{{SESSION_ID}}',   sessionId)
      .replaceAll('{{CUSTOMER_ID}}',  session.customer_id)
      .replaceAll('{{AGENT_ID}}',     session.agent_id)
      .replaceAll('{{TENANT_NAME}}',  session.tenant_name ?? 'CoBrowse')
      .replaceAll('{{STATUS}}',       session.status);

    reply.type('text/html').send(html);
  });

  // ─── Customer approves consent ───────────────────────────────────────────────
  fastify.post('/:sessionId/approve', {
    schema: {
      params: {
        type: 'object',
        properties: { sessionId: { type: 'string', format: 'uuid' } },
        required: ['sessionId'],
      },
      body: {
        type: 'object',
        required: ['customerId'],
        properties: {
          customerId: { type: 'string', minLength: 1, maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { sessionId } = request.params;
    const { customerId } = request.body;

    const { customerToken, session } = await sessionService.recordConsent({
      sessionId,
      customerId,
    });

    reply.send({
      approved: true,
      customerToken,
      sessionId,
      message: 'Consent recorded. Your agent can now see your screen.',
    });
  });

  // ─── Customer declines consent ───────────────────────────────────────────────
  fastify.post('/:sessionId/decline', {
    schema: {
      params: {
        type: 'object',
        properties: { sessionId: { type: 'string', format: 'uuid' } },
        required: ['sessionId'],
      },
      body: {
        type: 'object',
        required: ['customerId'],
        properties: {
          customerId: { type: 'string', minLength: 1, maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { sessionId } = request.params;
    const { customerId } = request.body;

    await sessionService.recordDecline({ sessionId, customerId });
    reply.send({ declined: true });
  });
}

export default consentRoutes;
