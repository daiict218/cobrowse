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
import bcrypt from 'bcryptjs';

let app;
let pool;
let vendorId;
let adminCookie;
let viewerCookie;

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

  // Seed vendor + users
  const vr = await pool.query(
    `INSERT INTO vendors (name, contact_email) VALUES ('Tenants Test Vendor', 'tenants-test@vendor.com')
     ON CONFLICT (contact_email) DO UPDATE SET name = EXCLUDED.name RETURNING id`
  );
  vendorId = vr.rows[0].id;

  const adminHash = await bcrypt.hash('adminpass', 12);
  await pool.query(
    `INSERT INTO vendor_users (vendor_id, email, password_hash, name, role)
     VALUES ($1, 'tenants-admin@vendor.com', $2, 'Admin', 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [vendorId, adminHash]
  );

  const viewerHash = await bcrypt.hash('viewerpass', 12);
  await pool.query(
    `INSERT INTO vendor_users (vendor_id, email, password_hash, name, role)
     VALUES ($1, 'tenants-viewer@vendor.com', $2, 'Viewer', 'viewer')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [vendorId, viewerHash]
  );

  adminCookie = await loginAs('tenants-admin@vendor.com', 'adminpass');
  viewerCookie = await loginAs('tenants-viewer@vendor.com', 'viewerpass');
});

afterEach(async () => {
  // Clean tenants created by tests (keep test vendor)
  await pool.query('DELETE FROM tenants WHERE vendor_id = $1', [vendorId]);
});

afterAll(async () => {
  await pool.query('DELETE FROM portal_sessions');
  await pool.query('DELETE FROM vendor_users WHERE email LIKE $1', ['tenants-%']);
  await pool.query('DELETE FROM vendors WHERE id = $1', [vendorId]);
  await app.close();
  await teardown();
});

describe('portal tenant routes', () => {
  describe('POST /api/v1/portal/tenants', () => {
    it('admin can create tenant (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/tenants',
        headers: { cookie: adminCookie },
        payload: { name: 'New Tenant', allowedDomains: ['example.com'] },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.tenant.name).toBe('New Tenant');
      expect(body.keys.secretKey).toMatch(/^cb_sk_/);
      expect(body.keys.publicKey).toMatch(/^cb_pk_/);
    });

    it('viewer cannot create tenant (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/tenants',
        headers: { cookie: viewerCookie },
        payload: { name: 'Blocked Tenant' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects without auth (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/tenants',
        payload: { name: 'No Auth' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/portal/tenants', () => {
    it('lists vendor tenants', async () => {
      // Create a tenant first
      await app.inject({
        method: 'POST',
        url: '/api/v1/portal/tenants',
        headers: { cookie: adminCookie },
        payload: { name: 'Listed Tenant' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/portal/tenants',
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tenants.length).toBeGreaterThanOrEqual(1);
      expect(body.tenants.some((t) => t.name === 'Listed Tenant')).toBe(true);
    });

    it('viewer can list tenants', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/portal/tenants',
        headers: { cookie: viewerCookie },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/portal/tenants/:id', () => {
    it('returns tenant detail', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/tenants',
        headers: { cookie: adminCookie },
        payload: { name: 'Detail Tenant' },
      });
      const tenantId = createRes.json().tenant.id;

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().tenant.name).toBe('Detail Tenant');
    });

    it('rejects cross-vendor access (404)', async () => {
      // Create a tenant for our vendor
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/tenants',
        headers: { cookie: adminCookie },
        payload: { name: 'My Tenant' },
      });
      const tenantId = createRes.json().tenant.id;

      // Create another vendor
      const vr2 = await pool.query(
        `INSERT INTO vendors (name, contact_email) VALUES ('Other Vendor', 'other@vendor.com')
         ON CONFLICT (contact_email) DO UPDATE SET name = EXCLUDED.name RETURNING id`
      );
      const otherVendorId = vr2.rows[0].id;
      const hash2 = await bcrypt.hash('otherpass', 12);
      await pool.query(
        `INSERT INTO vendor_users (vendor_id, email, password_hash, name, role)
         VALUES ($1, 'other-admin@vendor.com', $2, 'Other Admin', 'admin')
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [otherVendorId, hash2]
      );
      const otherCookie = await loginAs('other-admin@vendor.com', 'otherpass');

      // Try to access tenant from other vendor
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}`,
        headers: { cookie: otherCookie },
      });
      expect(res.statusCode).toBe(404);

      // Cleanup
      await pool.query('DELETE FROM portal_sessions WHERE vendor_id = $1', [otherVendorId]);
      await pool.query('DELETE FROM vendor_users WHERE vendor_id = $1', [otherVendorId]);
      await pool.query('DELETE FROM vendors WHERE id = $1', [otherVendorId]);
    });
  });

  describe('PUT /api/v1/portal/tenants/:id', () => {
    it('admin can update tenant', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/tenants',
        headers: { cookie: adminCookie },
        payload: { name: 'Before Update' },
      });
      const tenantId = createRes.json().tenant.id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/portal/tenants/${tenantId}`,
        headers: { cookie: adminCookie },
        payload: { name: 'After Update' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().tenant.name).toBe('After Update');
    });

    it('viewer cannot update tenant (403)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/tenants',
        headers: { cookie: adminCookie },
        payload: { name: 'Viewer Edit Test' },
      });
      const tenantId = createRes.json().tenant.id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/v1/portal/tenants/${tenantId}`,
        headers: { cookie: viewerCookie },
        payload: { name: 'Blocked' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /api/v1/portal/tenants/:id/rotate-keys', () => {
    it('admin can rotate keys', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/tenants',
        headers: { cookie: adminCookie },
        payload: { name: 'Rotate Test' },
      });
      const tenantId = createRes.json().tenant.id;

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/portal/tenants/${tenantId}/rotate-keys`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.keys.secretKey).toMatch(/^cb_sk_/);
      expect(body.keys.publicKey).toMatch(/^cb_pk_/);
      expect(body.warning).toContain('shown ONCE');
    });
  });

  describe('masking rules', () => {
    it('GET + PUT masking rules', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/tenants',
        headers: { cookie: adminCookie },
        payload: { name: 'Masking Test' },
      });
      const tenantId = createRes.json().tenant.id;

      // GET default rules
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/masking-rules`,
        headers: { cookie: adminCookie },
      });
      expect(getRes.statusCode).toBe(200);

      // PUT updated rules
      const putRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/portal/tenants/${tenantId}/masking-rules`,
        headers: { cookie: adminCookie },
        payload: { selectors: ['#ssn'], maskTypes: ['password'], patterns: [] },
      });
      expect(putRes.statusCode).toBe(200);
      expect(putRes.json().rules.selectors).toContain('#ssn');
    });
  });
});
