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
import { hashApiKey } from '../../../src/utils/token.js';

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

  // Seed vendor + admin user + tenant
  const vr = await pool.query(
    `INSERT INTO vendors (name, contact_email) VALUES ('AuthFail Test Vendor', 'authfail-test@vendor.com')
     ON CONFLICT (contact_email) DO UPDATE SET name = EXCLUDED.name RETURNING id`
  );
  vendorId = vr.rows[0].id;

  const adminHash = await bcrypt.hash('adminpass', 12);
  await pool.query(
    `INSERT INTO vendor_users (vendor_id, email, password_hash, name, role)
     VALUES ($1, 'authfail-admin@vendor.com', $2, 'Admin', 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [vendorId, adminHash]
  );

  // Create a tenant for this vendor
  const secretHash = hashApiKey('cb_sk_authfail_test');
  const publicHash = hashApiKey('cb_pk_authfail_test');
  const tr = await pool.query(
    `INSERT INTO tenants (name, secret_key_hash, public_key_hash, vendor_id)
     VALUES ('AuthFail Test Tenant', $1, $2, $3)
     ON CONFLICT (secret_key_hash) DO UPDATE SET name = EXCLUDED.name, vendor_id = EXCLUDED.vendor_id
     RETURNING id`,
    [secretHash, publicHash, vendorId]
  );
  tenantId = tr.rows[0].id;

  adminCookie = await loginAs('authfail-admin@vendor.com', 'adminpass');
});

afterEach(async () => {
  await pool.query('DELETE FROM auth_failures WHERE tenant_id = $1', [tenantId]);
});

afterAll(async () => {
  await pool.query('DELETE FROM auth_failures WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM key_events WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
  await pool.query('DELETE FROM portal_sessions');
  await pool.query('DELETE FROM vendor_users WHERE email LIKE $1', ['authfail-%']);
  await pool.query('DELETE FROM vendors WHERE id = $1', [vendorId]);
  await app.close();
  await teardown();
});

describe('GET /api/v1/portal/tenants/:id/auth-failures', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/portal/tenants/${tenantId}/auth-failures`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns empty array when no failures', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/portal/tenants/${tenantId}/auth-failures`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.failures).toEqual([]);
  });

  it('returns failures scoped to tenant', async () => {
    // Insert test failures directly
    await pool.query(
      `INSERT INTO auth_failures (tenant_id, auth_type, identifier, ip_address, reason)
       VALUES ($1, 'api_key', 'cb_sk_12****', '10.0.0.1', 'invalid_key'),
              ($1, 'portal_login', 'ad***@foo.com', '10.0.0.2', 'bad_password')`,
      [tenantId]
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/portal/tenants/${tenantId}/auth-failures`,
      headers: { cookie: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.failures).toHaveLength(2);
    expect(body.failures[0]).toHaveProperty('auth_type');
    expect(body.failures[0]).toHaveProperty('identifier');
    expect(body.failures[0]).toHaveProperty('ip_address');
    expect(body.failures[0]).toHaveProperty('reason');
    expect(body.failures[0]).toHaveProperty('created_at');
  });

  it('respects limit parameter', async () => {
    // Insert 5 failures
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO auth_failures (tenant_id, auth_type, identifier, ip_address, reason)
         VALUES ($1, 'api_key', 'cb_sk_12****', '10.0.0.1', 'invalid_key')`,
        [tenantId]
      );
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/portal/tenants/${tenantId}/auth-failures?limit=2`,
      headers: { cookie: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.failures).toHaveLength(2);
  });

  it('returns 404 for tenant owned by another vendor', async () => {
    // Create another vendor with a tenant
    const otherVr = await pool.query(
      `INSERT INTO vendors (name, contact_email) VALUES ('Other Vendor', 'other-authfail@vendor.com')
       ON CONFLICT (contact_email) DO UPDATE SET name = EXCLUDED.name RETURNING id`
    );
    const otherVendorId = otherVr.rows[0].id;

    const otherSecretHash = hashApiKey('cb_sk_other_authfail');
    const otherTr = await pool.query(
      `INSERT INTO tenants (name, secret_key_hash, public_key_hash, vendor_id)
       VALUES ('Other Tenant', $1, $2, $3)
       ON CONFLICT (secret_key_hash) DO UPDATE SET name = EXCLUDED.name, vendor_id = EXCLUDED.vendor_id
       RETURNING id`,
      [otherSecretHash, hashApiKey('cb_pk_other_authfail'), otherVendorId]
    );
    const otherTenantId = otherTr.rows[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/portal/tenants/${otherTenantId}/auth-failures`,
      headers: { cookie: adminCookie },
    });

    expect(res.statusCode).toBe(404);

    // Cleanup
    await pool.query('DELETE FROM tenants WHERE id = $1', [otherTenantId]);
    await pool.query('DELETE FROM vendors WHERE id = $1', [otherVendorId]);
  });

  it('returns failures ordered by created_at DESC (newest first)', async () => {
    await pool.query(
      `INSERT INTO auth_failures (tenant_id, auth_type, identifier, ip_address, reason, created_at)
       VALUES ($1, 'api_key', 'cb_sk_ol****', '10.0.0.1', 'invalid_key', NOW() - INTERVAL '1 hour'),
              ($1, 'api_key', 'cb_sk_ne****', '10.0.0.1', 'expired_key', NOW())`,
      [tenantId]
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/portal/tenants/${tenantId}/auth-failures`,
      headers: { cookie: adminCookie },
    });

    const body = JSON.parse(res.body);
    expect(body.failures[0].reason).toBe('expired_key');
    expect(body.failures[1].reason).toBe('invalid_key');
  });
});
