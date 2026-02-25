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

beforeAll(async () => {
  await setupDatabase();
  pool = getPool();
  app = await buildApp();
  await app.ready();

  // Seed a test vendor + user
  const vr = await pool.query(
    `INSERT INTO vendors (name, contact_email) VALUES ('Test Vendor', 'portal-test@vendor.com')
     ON CONFLICT (contact_email) DO UPDATE SET name = EXCLUDED.name RETURNING id`
  );
  vendorId = vr.rows[0].id;

  const hash = await bcrypt.hash('testpass123', 12);
  await pool.query(
    `INSERT INTO vendor_users (vendor_id, email, password_hash, name, role)
     VALUES ($1, 'portal-test@vendor.com', $2, 'Test Admin', 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [vendorId, hash]
  );

  // Also seed a viewer user
  const viewerHash = await bcrypt.hash('viewerpass', 12);
  await pool.query(
    `INSERT INTO vendor_users (vendor_id, email, password_hash, name, role)
     VALUES ($1, 'viewer@vendor.com', $2, 'Test Viewer', 'viewer')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [vendorId, viewerHash]
  );
});

afterEach(async () => {
  await pool.query('DELETE FROM portal_sessions');
});

afterAll(async () => {
  await pool.query('DELETE FROM vendor_users WHERE email IN ($1, $2)', ['portal-test@vendor.com', 'viewer@vendor.com']);
  await pool.query('DELETE FROM vendors WHERE id = $1', [vendorId]);
  await app.close();
  await teardown();
});

/**
 * Helper: login and extract session cookie.
 */
async function loginAs(email, password) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/portal/auth/login',
    payload: { email, password },
  });
  const setCookie = res.headers['set-cookie'];
  const match = setCookie?.match(/cb_portal_session=([^\s;]+)/);
  return { response: res, cookie: match ? `cb_portal_session=${match[1]}` : null };
}

describe('portal auth routes', () => {
  describe('POST /api/v1/portal/auth/login', () => {
    it('returns user and sets session cookie (200)', async () => {
      const { response, cookie } = await loginAs('portal-test@vendor.com', 'testpass123');
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.user.email).toBe('portal-test@vendor.com');
      expect(body.user.role).toBe('admin');
      expect(cookie).toBeTruthy();
    });

    it('rejects invalid password (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/auth/login',
        payload: { email: 'portal-test@vendor.com', password: 'wrong' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects unknown email (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/auth/login',
        payload: { email: 'nobody@test.com', password: 'pass' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('validates required fields (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/auth/login',
        payload: { email: 'test@test.com' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/portal/auth/me', () => {
    it('returns current user with valid cookie', async () => {
      const { cookie } = await loginAs('portal-test@vendor.com', 'testpass123');
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/portal/auth/me',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().user.email).toBe('portal-test@vendor.com');
    });

    it('rejects without cookie (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/portal/auth/me',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/portal/auth/logout', () => {
    it('clears the session and cookie', async () => {
      const { cookie } = await loginAs('portal-test@vendor.com', 'testpass123');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/portal/auth/logout',
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['set-cookie']).toContain('Max-Age=0');

      // Session should be invalidated
      const meRes = await app.inject({
        method: 'GET',
        url: '/api/v1/portal/auth/me',
        headers: { cookie },
      });
      expect(meRes.statusCode).toBe(401);
    });
  });
});
