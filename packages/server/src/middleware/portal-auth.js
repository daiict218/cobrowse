import { validateSession } from '../services/vendor-auth.js';
import { ForbiddenError } from '../utils/errors.js';

/**
 * Extract the portal session cookie from the raw Cookie header.
 * Avoids pulling in @fastify/cookie for a single cookie.
 */
function extractSessionCookie(request) {
  const header = request.headers.cookie;
  if (!header) return null;

  const match = header.match(/(?:^|;\s*)cb_portal_session=([^\s;]+)/);
  return match ? match[1] : null;
}

/**
 * Authenticate a portal request via session cookie.
 * Sets request.portalUser with the validated user info.
 */
async function authenticatePortal(request, reply) {
  const sessionId = extractSessionCookie(request);
  request.portalUser = await validateSession(sessionId);
}

/**
 * Authenticate + require admin role.
 * Use on all mutating endpoints (create, update, delete, rotate keys).
 */
async function requireAdmin(request, reply) {
  await authenticatePortal(request, reply);
  if (request.portalUser.role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }
}

export { authenticatePortal, requireAdmin, extractSessionCookie };
