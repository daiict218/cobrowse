import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

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
let tenantId;
let sessionId;
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
    `INSERT INTO vendors (name, contact_email) VALUES ('Recordings Vendor', 'recordings@vendor.com')
     ON CONFLICT (contact_email) DO UPDATE SET name = EXCLUDED.name RETURNING id`
  );
  vendorId = vr.rows[0].id;

  const adminHash = await bcrypt.hash('recadminpass', 12);
  await pool.query(
    `INSERT INTO vendor_users (vendor_id, email, password_hash, name, role)
     VALUES ($1, 'rec-admin@vendor.com', $2, 'Rec Admin', 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [vendorId, adminHash]
  );

  const viewerHash = await bcrypt.hash('recviewerpass', 12);
  await pool.query(
    `INSERT INTO vendor_users (vendor_id, email, password_hash, name, role)
     VALUES ($1, 'rec-viewer@vendor.com', $2, 'Rec Viewer', 'viewer')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [vendorId, viewerHash]
  );

  adminCookie = await loginAs('rec-admin@vendor.com', 'recadminpass');
  viewerCookie = await loginAs('rec-viewer@vendor.com', 'recviewerpass');

  // Create tenant with sessionReplay enabled
  const createRes = await app.inject({
    method: 'POST',
    url: '/api/v1/portal/tenants',
    headers: { cookie: adminCookie },
    payload: { name: 'Recordings Tenant' },
  });
  tenantId = createRes.json().tenant.id;

  // Insert a test session
  const sr = await pool.query(
    `INSERT INTO sessions (tenant_id, agent_id, customer_id, status, end_reason, customer_joined_at, ended_at)
     VALUES ($1, 'agent_rec_1', 'cust_rec_1', 'ended', 'agent', NOW() - INTERVAL '5 minutes', NOW())
     RETURNING id`,
    [tenantId]
  );
  sessionId = sr.rows[0].id;

  // Insert a recording for that session
  await pool.query(
    `INSERT INTO session_recordings (session_id, tenant_id, storage_key, status, event_count, duration_ms, compressed_size, raw_size, completed_at)
     VALUES ($1, $2, $3, 'complete', 120, 300000, 7500, 42000, NOW())`,
    [sessionId, tenantId, `${sessionId}.gz`]
  );
});

afterAll(async () => {
  await pool.query('DELETE FROM session_recordings WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM key_events WHERE tenant_id IN (SELECT id FROM tenants WHERE vendor_id = $1)', [vendorId]);
  await pool.query('DELETE FROM sessions WHERE tenant_id = $1', [tenantId]);
  await pool.query('DELETE FROM tenants WHERE vendor_id = $1', [vendorId]);
  await pool.query('DELETE FROM portal_sessions');
  await pool.query('DELETE FROM vendor_users WHERE email LIKE $1', ['rec-%']);
  await pool.query('DELETE FROM vendors WHERE id = $1', [vendorId]);
  await app.close();
  await teardown();
});

describe('portal recordings routes', () => {
  describe('GET /api/v1/portal/tenants/:id/recordings', () => {
    it('returns paginated recordings list', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/recordings?page=1&limit=20`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recordings).toBeInstanceOf(Array);
      expect(body.recordings.length).toBe(1);
      expect(body.total).toBe(1);
      expect(body.page).toBe(1);
      expect(body.recordings[0].session_id).toBe(sessionId);
      expect(body.recordings[0].status).toBe('complete');
      expect(body.recordings[0].agent_id).toBe('agent_rec_1');
      expect(body.recordings[0].customer_id).toBe('cust_rec_1');
    });

    it('filters by status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/recordings?status=failed`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recordings).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    it('viewer role can access recordings (read-only)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/recordings`,
        headers: { cookie: viewerCookie },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recordings.length).toBe(1);
    });

    it('rejects without auth (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/recordings`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for tenant owned by different vendor', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${fakeId}/recordings`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(404);
    });

    it('validates tenant id as UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/not-a-uuid/recordings`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/portal/tenants/:id/recordings/:sessionId', () => {
    it('rejects without auth (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/recordings/${sessionId}`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for tenant owned by different vendor', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${fakeId}/recordings/${sessionId}`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(404);
    });

    it('validates session id as UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/recordings/not-a-uuid`,
        headers: { cookie: adminCookie },
      });
      expect(res.statusCode).toBe(400);
    });

    it('viewer role can access recording data', async () => {
      // This will return 404 because there's no actual file on disk,
      // but it should NOT return 401 or 403 — viewer has access.
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/portal/tenants/${tenantId}/recordings/${sessionId}`,
        headers: { cookie: viewerCookie },
      });
      // 404 because storage file doesn't exist in test, not 401/403
      expect([200, 404]).toContain(res.statusCode);
    });
  });
});
