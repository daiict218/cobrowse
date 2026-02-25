import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, teardown, getPool } from '../helpers/setup.js';
import buildApp from '../../../src/app.js';
import bcrypt from 'bcrypt';

let app;
let pool;
let vendorId;
let tenantId;
let adminCookie;

async function loginAs(email, password) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/portal/auth/login',
    payload: { email, password },
  });
  const setCookie = res.headers['set-cookie'];
  const match = setCookie?.match(/cb_portal_session=([^\s;]+)/);
  return match ? `cb_portal_session=${match[1]}` : null;
}

beforeAll(async () => {
  await setupDatabase();
  pool = getPool();
  app = await buildApp();
  await app.ready();

  // Seed vendor + admin user
  const vr = await pool.query(
    `INSERT INTO vendors (name, contact_email) VALUES ('Analytics Vendor', 'analytics@vendor.com')
     ON CONFLICT (contact_email) DO UPDATE SET name = EXCLUDED.name RETURNING id`
  );
  vendorId = vr.rows[0].id;

  const hash = await bcrypt.hash('analyticspass', 12);
  await pool.query(
    `INSERT INTO vendor_users (vendor_id, email, password_hash, name, role)
     VALUES ($1, 'analytics-admin@vendor.com', $2, 'Admin', 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [vendorId, hash]
  );

  adminCookie = await loginAs('analytics-admin@vendor.com', 'analyticspass');

  // Create a tenant via the API
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/portal/tenants',
    headers: { cookie: adminCookie },
    payload: { name: 'Analytics Tenant' },
  });
  tenantId = createRes.json().tenant.id;

  // Insert some test sessions directly
  for (let i = 0; i < 5; i++) {
    const status = i < 3 ? 'ended' : 'active';
    const endReason = status === 'ended' ? (i === 0 ? 'idle_timeout' : 'agent') : null;
    await pool.query(
      `INSERT INTO sessions (tenant_id, agent_id, customer_id, status, end_reason, customer_joined_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        `agent_${i}`,
        `cust_${i}`,
        status,
        endReason,
        i < 4 ? new Date() : null, // 4 of 5 consented
        status === 'ended' ? new Date() : null,
      ]
    );
  }
});

afterAll(async () => {
  await pool.query('DELETE FROM sessions WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM tenants WHERE vendor_id = $1', [vendorId]);
  await pool.query('DELETE FROM portal_sessions');
  await pool.query('DELETE FROM vendor_users WHERE email LIKE $1', ['analytics-%']);
  await pool.query('DELETE FROM vendors WHERE id = $1', [vendorId]);
  await app.close();
  await teardown();
});

describe('portal analytics routes', () => {
  describe('GET /api/v1/portal/tenants/:id/sessions', () => {
    it('returns paginated session list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/sessions?page=1&limit=3`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sessions.length).toBeLessThanOrEqual(3);
      expect(body.total).toBe(5);
      expect(body.page).toBe(1);
    });

    it('filters by status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/sessions?status=active`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sessions.every((s) => s.status === 'active')).toBe(true);
    });
  });

  describe('GET /api/v1/portal/tenants/:id/analytics', () => {
    it('returns aggregated analytics', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/analytics`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalSessions).toBe(5);
      expect(body.consentedSessions).toBeGreaterThanOrEqual(4);
      expect(body.consentRate).toBeGreaterThan(0);
      expect(body.daily).toBeInstanceOf(Array);
    });

    it('accepts date range params', async () => {
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/analytics?from=${from}`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/portal/analytics/overview', () => {
    it('returns vendor overview', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/portal/analytics/overview',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tenantCount).toBeGreaterThanOrEqual(1);
      expect(body.tenants).toBeInstanceOf(Array);
      expect(body.tenants.some((t) => t.name === 'Analytics Tenant')).toBe(true);
    });

    it('rejects without auth (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/portal/analytics/overview',
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
