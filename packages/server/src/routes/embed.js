import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticateJwt } from '../middleware/jwt-auth.js';
import * as sessionService from '../services/session.js';
import { NotFoundError } from '../utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const viewerTemplate = fs.readFileSync(
  path.join(__dirname, '../views/embed-viewer.html'),
  'utf8'
);

/** Escape HTML special chars to prevent XSS in template interpolation. */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Embed routes — iframe-friendly session viewer authenticated via JWT.
 *
 * GET /embed/session/:sessionId?token=JWT
 */
async function embedRoutes(fastify) {
  // Strip X-Frame-Options for embed pages so they can be framed by tenant domains.
  // Helmet sets X-Frame-Options via onRequest at the parent scope; our plugin-level
  // onRequest runs after Helmet's, so we can safely remove it before the response.
  // CSP frame-ancestors is the modern replacement that supports multiple origins.
  fastify.addHook('onRequest', async (request, reply) => {
    reply.raw.removeHeader('x-frame-options');
    reply.raw.removeHeader('X-Frame-Options');
  });

  fastify.get('/session/:sessionId', async (request, reply) => {
    const { sessionId } = request.params;

    // Authenticate via JWT (from ?token= query param)
    await authenticateJwt(request);

    // Verify session exists and belongs to tenant
    let session;
    try {
      session = await sessionService.getSession(sessionId, request.tenant.id);
    } catch {
      throw new NotFoundError('Session not found');
    }

    if (session.status === 'ended') {
      reply.code(410).type('text/html').send(
        '<h1>This co-browse session has ended.</h1><p>You can close this window.</p>'
      );
      return;
    }

    // Dynamic CSP: allow framing from tenant's registered domains
    const allowedDomains = request.tenant.allowed_domains || [];
    const frameAncestors = ["'self'", ...allowedDomains.map((d) =>
      d.startsWith('http') ? d : `https://${d}`
    )];

    // Override CSP frame-ancestors for this response
    const csp = reply.getHeader('content-security-policy');
    if (csp) {
      const updated = csp
        .split(';')
        .map((d) => {
          const trimmed = d.trimStart();
          if (trimmed.startsWith('frame-ancestors')) {
            return ` frame-ancestors ${frameAncestors.join(' ')}`;
          }
          return d;
        })
        .join(';');
      reply.header('content-security-policy', updated);
    }

    const serverUrl = `${request.protocol}://${request.hostname}`;
    const nonce = reply.cspNonce?.script ?? '';
    const jwtToken = request.query.token || '';

    const html = viewerTemplate
      .replaceAll('{{SESSION_ID}}', escapeHtml(sessionId))
      .replaceAll('{{TENANT_ID}}', escapeHtml(request.tenant.id))
      .replaceAll('{{SERVER_URL}}', escapeHtml(serverUrl))
      .replaceAll('{{JWT_TOKEN}}', escapeHtml(jwtToken))
      .replaceAll('{{AGENT_ID}}', escapeHtml(request.agent?.id || ''))
      .replaceAll('{{NONCE}}', nonce);

    reply.type('text/html').send(html);
  });
}

export default embedRoutes;
