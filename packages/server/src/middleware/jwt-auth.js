import { jwtVerify, importSPKI } from 'jose';
import * as db from '../db/index.js';
import { UnauthorizedError } from '../utils/errors.js';

/**
 * JWT authentication middleware for vendor integration.
 *
 * Vendors (Sprinklr, Zendesk, etc.) sign JWTs with their RS256 private key.
 * We verify using the public key configured on the tenant via PUT /admin/jwt-config.
 *
 * JWT claims:
 *   sub       — agent ID (required)
 *   tenantId  — tenant UUID (required)
 *   name      — agent display name (optional)
 *   aud       — audience, verified if tenant configured it
 *   iss       — issuer, verified if tenant configured it
 */

/** Cache imported SPKI key objects per tenantId to avoid re-parsing PEM on every request. */
const _keyCache = new Map();

/**
 * Extract JWT from Authorization: Bearer header or ?token= query param.
 */
function _extractJwt(request) {
  const authHeader = request.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return request.query?.token || null;
}

/**
 * Decode JWT payload WITHOUT verification — only used to extract tenantId
 * for public key lookup. The token is fully verified immediately after.
 */
function _decodePayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return payload;
  } catch {
    return null;
  }
}

/**
 * Authenticate a request using a JWT token.
 * On success, sets request.tenant and request.agent.
 */
async function authenticateJwt(request) {
  const token = _extractJwt(request);
  if (!token) throw new UnauthorizedError('JWT required');

  // Decode (unverified) to get tenantId for key lookup
  const unverified = _decodePayload(token);
  if (!unverified?.tenantId) {
    throw new UnauthorizedError('JWT must include tenantId claim');
  }

  // Look up tenant and jwt_config
  const result = await db.query(
    `SELECT id, name, allowed_domains, masking_rules, feature_flags, is_active, jwt_config
     FROM tenants WHERE id = $1`,
    [unverified.tenantId]
  );

  if (!result.rows.length) throw new UnauthorizedError('Tenant not found');

  const tenant = result.rows[0];
  if (!tenant.is_active) throw new UnauthorizedError('Tenant account is inactive');
  if (!tenant.jwt_config?.publicKeyPem) {
    throw new UnauthorizedError('JWT authentication not configured for this tenant');
  }

  const { publicKeyPem, issuer, audience } = tenant.jwt_config;

  // Import (or cache) the SPKI public key
  let publicKey = _keyCache.get(tenant.id);
  if (!publicKey) {
    try {
      publicKey = await importSPKI(publicKeyPem, 'RS256');
    } catch {
      throw new UnauthorizedError('Invalid public key configured for tenant');
    }
    _keyCache.set(tenant.id, publicKey);
  }

  // Verify the JWT
  const verifyOptions = { algorithms: ['RS256'] };
  if (issuer) verifyOptions.issuer = issuer;
  if (audience) verifyOptions.audience = audience;

  let payload;
  try {
    const verified = await jwtVerify(token, publicKey, verifyOptions);
    payload = verified.payload;
  } catch (err) {
    throw new UnauthorizedError(`JWT verification failed: ${err.message}`);
  }

  if (!payload.sub) {
    throw new UnauthorizedError('JWT must include sub claim (agent ID)');
  }

  // Set request context (same shape as API key auth)
  request.tenant = {
    id: tenant.id,
    name: tenant.name,
    allowed_domains: tenant.allowed_domains,
    masking_rules: tenant.masking_rules,
    feature_flags: tenant.feature_flags,
    keyType: 'jwt',
  };

  request.agent = {
    id: payload.sub,
    displayName: payload.name || payload.sub,
  };
}

/**
 * Evict the cached SPKI key for a tenant (call after key rotation).
 */
function evictKeyCache(tenantId) {
  _keyCache.delete(tenantId);
}

export { authenticateJwt, evictKeyCache, _extractJwt, _keyCache };
