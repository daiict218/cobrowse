import * as db from '../db/index.js';
import { hashApiKey } from '../utils/token.js';
import { UnauthorizedError } from '../utils/errors.js';
import { authenticateJwt } from './jwt-auth.js';
import * as authRateLimiter from '../utils/auth-rate-limiter.js';
import * as authAudit from '../services/auth-audit.js';

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

async function _resolveTenant(apiKey, request) {
  if (!apiKey) throw new UnauthorizedError('API key required');

  const ip = request?.ip;
  const userAgent = request?.headers?.['user-agent'];

  // Rate limit check — throws 429 if this IP has too many recent failures
  authRateLimiter.check(ip);

  const hash = hashApiKey(apiKey);
  const isSecret = apiKey.startsWith('cb_sk_');

  const column = isSecret ? 'secret_key_hash' : 'public_key_hash';

  const result = await db.query(
    `SELECT id, name, allowed_domains, masking_rules, feature_flags, is_active, key_expires_at
     FROM tenants WHERE ${column} = $1`,
    [hash]
  );

  if (!result.rows.length) {
    authRateLimiter.recordFailure(ip);
    authAudit.logFailure({
      tenantId: null,
      authType: 'api_key',
      identifier: apiKey,
      ip,
      userAgent,
      reason: 'invalid_key',
    });
    throw new UnauthorizedError('Invalid API key');
  }

  const tenant = result.rows[0];

  if (!tenant.is_active) {
    authRateLimiter.recordFailure(ip);
    authAudit.logFailure({
      tenantId: tenant.id,
      authType: 'api_key',
      identifier: apiKey,
      ip,
      userAgent,
      reason: 'inactive_tenant',
    });
    throw new UnauthorizedError('Tenant account is inactive');
  }

  // Check key expiry (opt-in: NULL means no expiry)
  if (tenant.key_expires_at && new Date(tenant.key_expires_at) < new Date()) {
    authRateLimiter.recordFailure(ip);
    authAudit.logFailure({
      tenantId: tenant.id,
      authType: 'api_key',
      identifier: apiKey,
      ip,
      userAgent,
      reason: 'expired_key',
    });
    throw new UnauthorizedError('API key has expired');
  }

  // Success — reset rate limiter for this IP
  authRateLimiter.recordSuccess(ip);

  return { ...tenant, keyType: isSecret ? 'secret' : 'public' };
}

function _extractKey(request) {
  // Only accept API keys via headers — never query params.
  // Query params appear in server logs, proxy logs, browser history, and Referer headers.
  return (
    request.headers['x-api-key'] ||
    request.headers['x-cb-secret-key'] ||
    request.headers['x-cb-public-key']
  );
}

/**
 * Accepts both secret and public keys.
 * Use for endpoints the SDK needs to call (e.g. masking rules, ably-auth/invite).
 */
async function authenticate(request, reply) {
  const apiKey = _extractKey(request);
  request.tenant = await _resolveTenant(apiKey, request);
}

/**
 * Accepts only secret keys.
 * Use for agent-facing endpoints: create/end session, fetch snapshot, admin ops.
 */
async function authenticateSecret(request, reply) {
  const apiKey = _extractKey(request);
  const tenant = await _resolveTenant(apiKey, request);

  if (tenant.keyType !== 'secret') {
    throw new UnauthorizedError('This endpoint requires a secret API key (cb_sk_...)');
  }

  request.tenant = tenant;
}

/**
 * Accepts secret API keys OR JWT Bearer tokens.
 * Use for agent-facing endpoints that vendors may call via JWT SSO.
 * Tries API key first (if header present), falls back to JWT.
 */
async function authenticateSecretOrJwt(request, reply) {
  const apiKey = _extractKey(request);

  if (apiKey) {
    // API key path
    const tenant = await _resolveTenant(apiKey, request);
    if (tenant.keyType !== 'secret') {
      throw new UnauthorizedError('This endpoint requires a secret API key (cb_sk_...)');
    }
    request.tenant = tenant;
    return;
  }

  // JWT path (Authorization: Bearer or ?token=)
  await authenticateJwt(request);
}

export { authenticate, authenticateSecret, authenticateSecretOrJwt };
