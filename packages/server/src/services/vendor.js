import * as db from '../db/index.js';
import { generateSecretKey, generatePublicKey, hashApiKey } from '../utils/token.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors.js';

// ─── Tenant CRUD (vendor-scoped) ──────────────────────────────────────────────

/**
 * List all tenants belonging to a vendor.
 */
async function listTenants(vendorId) {
  const result = await db.query(
    `SELECT id, name, allowed_domains, is_active, feature_flags, created_at, updated_at
     FROM tenants
     WHERE vendor_id = $1
     ORDER BY created_at DESC`,
    [vendorId]
  );
  return result.rows;
}

/**
 * Get a single tenant by ID, scoped to vendor.
 */
async function getTenant(vendorId, tenantId) {
  const result = await db.query(
    `SELECT id, name, allowed_domains, masking_rules, feature_flags, jwt_config,
            is_active, created_at, updated_at
     FROM tenants
     WHERE id = $1 AND vendor_id = $2`,
    [tenantId, vendorId]
  );
  if (!result.rows.length) {
    throw new NotFoundError('Tenant');
  }
  return result.rows[0];
}

/**
 * Create a new tenant for a vendor.
 * Returns the tenant + plaintext API keys (shown ONCE).
 */
async function createTenant(vendorId, { name, allowedDomains }) {
  if (!name || !name.trim()) {
    throw new ValidationError('Tenant name is required');
  }

  const secretKey = generateSecretKey();
  const publicKey = generatePublicKey();
  const secretHash = hashApiKey(secretKey);
  const publicHash = hashApiKey(publicKey);

  const result = await db.query(
    `INSERT INTO tenants (name, secret_key_hash, public_key_hash, allowed_domains, vendor_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, allowed_domains, is_active, feature_flags, created_at`,
    [name.trim(), secretHash, publicHash, allowedDomains || [], vendorId]
  );

  return {
    tenant: result.rows[0],
    keys: { secretKey, publicKey },
  };
}

/**
 * Update tenant properties (name, allowed_domains, feature_flags, is_active).
 */
async function updateTenant(vendorId, tenantId, updates) {
  // Verify ownership first
  await getTenant(vendorId, tenantId);

  const setClauses = [];
  const values = [];
  let idx = 1;

  if (updates.name !== undefined) {
    setClauses.push(`name = $${idx++}`);
    values.push(updates.name.trim());
  }
  if (updates.allowedDomains !== undefined) {
    setClauses.push(`allowed_domains = $${idx++}`);
    values.push(updates.allowedDomains);
  }
  if (updates.featureFlags !== undefined) {
    setClauses.push(`feature_flags = $${idx++}`);
    values.push(JSON.stringify(updates.featureFlags));
  }
  if (updates.isActive !== undefined) {
    setClauses.push(`is_active = $${idx++}`);
    values.push(updates.isActive);
  }

  if (setClauses.length === 0) {
    throw new ValidationError('No valid fields to update');
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(tenantId, vendorId);

  const result = await db.query(
    `UPDATE tenants SET ${setClauses.join(', ')}
     WHERE id = $${idx++} AND vendor_id = $${idx}
     RETURNING id, name, allowed_domains, is_active, feature_flags, created_at, updated_at`,
    values
  );

  return result.rows[0];
}

/**
 * Rotate API keys for a tenant. Returns new plaintext keys (shown ONCE).
 */
async function rotateKeys(vendorId, tenantId) {
  // Verify ownership
  await getTenant(vendorId, tenantId);

  const secretKey = generateSecretKey();
  const publicKey = generatePublicKey();

  await db.query(
    `UPDATE tenants SET secret_key_hash = $1, public_key_hash = $2, updated_at = NOW()
     WHERE id = $3 AND vendor_id = $4`,
    [hashApiKey(secretKey), hashApiKey(publicKey), tenantId, vendorId]
  );

  return { secretKey, publicKey };
}

// ─── Masking Rules ────────────────────────────────────────────────────────────

async function getMaskingRules(vendorId, tenantId) {
  const tenant = await getTenant(vendorId, tenantId);
  return tenant.masking_rules;
}

async function updateMaskingRules(vendorId, tenantId, rules) {
  // Verify ownership
  await getTenant(vendorId, tenantId);

  // Validate regex patterns
  if (rules.patterns) {
    for (const pattern of rules.patterns) {
      try {
        new RegExp(pattern);
      } catch {
        throw new ValidationError(`Invalid regex pattern: ${pattern}`);
      }
    }
  }

  const result = await db.query(
    `UPDATE tenants SET masking_rules = $1, updated_at = NOW()
     WHERE id = $2 AND vendor_id = $3
     RETURNING masking_rules`,
    [JSON.stringify(rules), tenantId, vendorId]
  );

  return result.rows[0].masking_rules;
}

// ─── Sessions (read-only, vendor-scoped) ──────────────────────────────────────

/**
 * List sessions for a tenant with pagination and optional status filter.
 */
async function listSessions(vendorId, tenantId, { page = 1, limit = 20, status } = {}) {
  // Verify ownership
  await getTenant(vendorId, tenantId);

  const offset = (page - 1) * limit;
  const conditions = ['s.tenant_id = $1'];
  const values = [tenantId];
  let idx = 2;

  if (status) {
    conditions.push(`s.status = $${idx++}`);
    values.push(status);
  }

  const where = conditions.join(' AND ');

  const [countResult, dataResult] = await Promise.all([
    db.query(
      `SELECT COUNT(*) FROM sessions s WHERE ${where}`,
      values
    ),
    db.query(
      `SELECT s.id, s.agent_id, s.customer_id, s.status, s.end_reason,
              s.created_at, s.customer_joined_at, s.ended_at, s.channel_ref
       FROM sessions s
       WHERE ${where}
       ORDER BY s.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...values, limit, offset]
    ),
  ]);

  return {
    sessions: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}

// ─── Analytics ────────────────────────────────────────────────────────────────

/**
 * Aggregated analytics for a single tenant within a date range.
 */
async function getTenantAnalytics(vendorId, tenantId, { from, to } = {}) {
  // Verify ownership
  await getTenant(vendorId, tenantId);

  const fromDate = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const toDate = to || new Date().toISOString();

  // Aggregate stats in a single pass
  const statsResult = await db.query(
    `SELECT
       COUNT(*) AS total_sessions,
       COUNT(*) FILTER (WHERE status = 'active' OR customer_joined_at IS NOT NULL) AS consented_sessions,
       COUNT(*) FILTER (WHERE status = 'ended' AND end_reason = 'idle_timeout') AS idle_timeouts,
       ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - created_at)))::numeric, 1) AS avg_duration_seconds
     FROM sessions
     WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3`,
    [tenantId, fromDate, toDate]
  );

  // Daily session counts for charting
  const dailyResult = await db.query(
    `SELECT DATE(created_at) AS day, COUNT(*) AS count
     FROM sessions
     WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
     GROUP BY DATE(created_at)
     ORDER BY day`,
    [tenantId, fromDate, toDate]
  );

  const stats = statsResult.rows[0];
  const total = parseInt(stats.total_sessions, 10);
  const consented = parseInt(stats.consented_sessions, 10);

  return {
    totalSessions: total,
    consentedSessions: consented,
    consentRate: total > 0 ? Math.round((consented / total) * 100) : 0,
    idleTimeouts: parseInt(stats.idle_timeouts, 10),
    avgDurationSeconds: parseFloat(stats.avg_duration_seconds) || 0,
    daily: dailyResult.rows.map((r) => ({ day: r.day, count: parseInt(r.count, 10) })),
    from: fromDate,
    to: toDate,
  };
}

/**
 * Cross-tenant vendor overview (dashboard summary).
 */
async function getVendorOverview(vendorId) {
  // Per-tenant session counts (last 24h and 7d)
  const tenantStats = await db.query(
    `SELECT t.id, t.name, t.is_active,
       COUNT(s.id) FILTER (WHERE s.created_at >= NOW() - INTERVAL '24 hours') AS sessions_24h,
       COUNT(s.id) FILTER (WHERE s.created_at >= NOW() - INTERVAL '7 days') AS sessions_7d,
       COUNT(s.id) AS sessions_total
     FROM tenants t
     LEFT JOIN sessions s ON s.tenant_id = t.id
     WHERE t.vendor_id = $1
     GROUP BY t.id, t.name, t.is_active
     ORDER BY sessions_7d DESC`,
    [vendorId]
  );

  // Vendor-wide totals
  const totals = await db.query(
    `SELECT
       COUNT(s.id) AS total_sessions,
       COUNT(s.id) FILTER (WHERE s.created_at >= NOW() - INTERVAL '24 hours') AS sessions_24h,
       COUNT(s.id) FILTER (WHERE s.created_at >= NOW() - INTERVAL '7 days') AS sessions_7d,
       COUNT(s.id) FILTER (WHERE s.status = 'active') AS active_now,
       COUNT(DISTINCT t.id) AS tenant_count
     FROM tenants t
     LEFT JOIN sessions s ON s.tenant_id = t.id
     WHERE t.vendor_id = $1`,
    [vendorId]
  );

  const row = totals.rows[0];

  return {
    tenantCount: parseInt(row.tenant_count, 10),
    totalSessions: parseInt(row.total_sessions, 10),
    sessions24h: parseInt(row.sessions_24h, 10),
    sessions7d: parseInt(row.sessions_7d, 10),
    activeNow: parseInt(row.active_now, 10),
    tenants: tenantStats.rows.map((t) => ({
      id: t.id,
      name: t.name,
      isActive: t.is_active,
      sessions24h: parseInt(t.sessions_24h, 10),
      sessions7d: parseInt(t.sessions_7d, 10),
      sessionsTotal: parseInt(t.sessions_total, 10),
    })),
  };
}

export {
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  rotateKeys,
  getMaskingRules,
  updateMaskingRules,
  listSessions,
  getTenantAnalytics,
  getVendorOverview,
};
