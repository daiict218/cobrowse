import * as db from '../db/index.js';
import logger from '../utils/logger.js';
import { authFailuresTotal } from '../utils/metrics.js';

/**
 * Auth failure audit service.
 *
 * Logs failed authentication attempts (API key, portal login, JWT) to the
 * auth_failures table. All writes are non-fatal — errors are logged but never
 * propagate to the caller. Same pattern as audit.logEvent().
 */

/**
 * Mask an identifier for safe storage / display.
 *   'cb_sk_1234abcdef...' → 'cb_sk_12****'
 *   'admin@foo.com'       → 'ad***@foo.com'
 */
function maskIdentifier(value, type) {
  if (!value) return null;

  if (type === 'api_key') {
    // Keep prefix + first 2 chars of the key portion, mask the rest
    const prefix = value.startsWith('cb_sk_') ? 'cb_sk_' : value.startsWith('cb_pk_') ? 'cb_pk_' : '';
    const keyPart = value.slice(prefix.length);
    return prefix + keyPart.slice(0, 2) + '****';
  }

  if (type === 'email') {
    const atIdx = value.indexOf('@');
    if (atIdx <= 0) return '****';
    const local = value.slice(0, atIdx);
    const domain = value.slice(atIdx);
    return local.slice(0, 2) + '***' + domain;
  }

  // Generic fallback: first 4 chars + ****
  return value.slice(0, 4) + '****';
}

/**
 * Log an auth failure to the DB and increment the Prometheus counter.
 *
 * @param {object} params
 * @param {string|null} params.tenantId  - NULL if key didn't match any tenant
 * @param {string}      params.authType  - 'api_key' | 'portal_login' | 'jwt'
 * @param {string}      params.identifier - raw value; will be masked before storage
 * @param {string}      params.ip
 * @param {string}      params.userAgent
 * @param {string}      params.reason    - 'invalid_key' | 'inactive_tenant' | 'bad_password' | 'expired_key' | 'disabled_account'
 */
async function logFailure({ tenantId, authType, identifier, ip, userAgent, reason }) {
  // Increment Prometheus counter (fire-and-forget, always succeeds)
  authFailuresTotal.inc({ auth_type: authType, reason });

  try {
    const maskedId = maskIdentifier(identifier, authType === 'portal_login' ? 'email' : 'api_key');
    const ua = userAgent ? userAgent.slice(0, 512) : null;
    await db.query(
      `INSERT INTO auth_failures (tenant_id, auth_type, identifier, ip_address, user_agent, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId || null, authType, maskedId, ip || null, ua, reason]
    );
  } catch (err) {
    // Auth audit failures must never crash the main flow
    logger.error({ err, authType, reason }, 'auth audit log write failed');
  }
}

/**
 * Fetch recent auth failures for a tenant.
 *
 * @param {string} tenantId
 * @param {number} limit - max rows (default 50)
 */
async function getRecentFailures(tenantId, limit = 50) {
  const result = await db.query(
    `SELECT id, auth_type, identifier, ip_address, user_agent, reason, created_at
     FROM auth_failures
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, limit]
  );
  return result.rows;
}

export { logFailure, getRecentFailures, maskIdentifier };
