'use strict';

const db = require('../db');
const { hashApiKey } = require('../utils/token');
const { UnauthorizedError } = require('../utils/errors');

/**
 * Authentication middleware for Fastify.
 *
 * Two API key types:
 *   cb_sk_... (secret key)  — agent and server-to-server operations
 *   cb_pk_... (public key)  — SDK init and read-only operations (masking rules)
 *
 * The resolved tenant is attached to request.tenant so route handlers don't
 * need to look it up again.
 *
 * Usage in routes:
 *   fastify.addHook('preHandler', authenticate)        // requires any valid key
 *   fastify.addHook('preHandler', authenticateSecret)  // requires secret key only
 */

async function _resolveTenant(apiKey) {
  if (!apiKey) throw new UnauthorizedError('API key required');

  const hash = hashApiKey(apiKey);
  const isSecret = apiKey.startsWith('cb_sk_');

  const column = isSecret ? 'secret_key_hash' : 'public_key_hash';

  const result = await db.query(
    `SELECT id, name, allowed_domains, masking_rules, feature_flags, is_active
     FROM tenants WHERE ${column} = $1`,
    [hash]
  );

  if (!result.rows.length) throw new UnauthorizedError('Invalid API key');

  const tenant = result.rows[0];
  if (!tenant.is_active) throw new UnauthorizedError('Tenant account is inactive');

  return { ...tenant, keyType: isSecret ? 'secret' : 'public' };
}

function _extractKey(request) {
  // Support both header formats for flexibility
  return (
    request.headers['x-api-key'] ||
    request.headers['x-cb-secret-key'] ||
    request.headers['x-cb-public-key'] ||
    request.query?.apiKey
  );
}

/**
 * Accepts both secret and public keys.
 * Use for endpoints the SDK needs to call (e.g. masking rules, ably-auth/invite).
 */
async function authenticate(request, reply) {
  const apiKey = _extractKey(request);
  request.tenant = await _resolveTenant(apiKey);
}

/**
 * Accepts only secret keys.
 * Use for agent-facing endpoints: create/end session, fetch snapshot, admin ops.
 */
async function authenticateSecret(request, reply) {
  const apiKey = _extractKey(request);
  const tenant = await _resolveTenant(apiKey);

  if (tenant.keyType !== 'secret') {
    throw new UnauthorizedError('This endpoint requires a secret API key (cb_sk_...)');
  }

  request.tenant = tenant;
}

module.exports = { authenticate, authenticateSecret };
