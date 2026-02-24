import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, cleanup, teardown, getTestKeys, createTestSession, getTestTenantId, getPool } from '../helpers/setup.js';
import buildApp from '../../../src/app.js';

let app;
const { secretKey } = getTestKeys();

beforeAll(async () => {
  await setupDatabase();
  app = await buildApp();
  await app.ready();
});

afterEach(async () => {
  const pool = getPool();
  // Clean recordings before sessions (FK constraint)
  await pool.query('DELETE FROM session_recordings');
  await cleanup();
  // Reset feature flag
  await pool.query(
    `UPDATE tenants SET feature_flags = jsonb_set(feature_flags, '{sessionReplay}', 'false') WHERE id = $1`,
    [getTestTenantId()]
  );
});

afterAll(async () => {
  const pool = getPool();
  await pool.query('DELETE FROM session_recordings');
  await app.close();
  await teardown();
});

// ── Helper to enable recording for the test tenant ──────────────────────────

async function enableRecording() {
  const pool = getPool();
  await pool.query(
    `UPDATE tenants SET feature_flags = jsonb_set(feature_flags, '{sessionReplay}', 'true') WHERE id = $1`,
    [getTestTenantId()]
  );
}

async function insertRecording(sessionId, overrides = {}) {
  const pool = getPool();
  const defaults = {
    tenant_id: getTestTenantId(),
    storage_key: `${sessionId}.gz`,
    event_count: 10,
    duration_ms: 30000,
    compressed_size: 1024,
    raw_size: 4096,
    status: 'complete',
  };
  const opts = { ...defaults, ...overrides };

  const result = await pool.query(
    `INSERT INTO session_recordings (session_id, tenant_id, storage_key, event_count, duration_ms, compressed_size, raw_size, status, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     RETURNING *`,
    [sessionId, opts.tenant_id, opts.storage_key, opts.event_count, opts.duration_ms, opts.compressed_size, opts.raw_size, opts.status]
  );
  return result.rows[0];
}

describe('recordings routes', () => {
  describe('GET /api/v1/recordings', () => {
    it('returns 403 when feature flag is disabled', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/recordings',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns empty list for tenant with no recordings', async () => {
      await enableRecording();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/recordings',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recordings).toEqual([]);
    });

    it('returns recordings list when recordings exist', async () => {
      await enableRecording();
      const session = await createTestSession({ status: 'ended' });
      await insertRecording(session.id);

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/recordings',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recordings).toHaveLength(1);
      expect(body.recordings[0].session_id).toBe(session.id);
    });

    it('rejects without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/recordings',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/recordings/:sessionId/meta', () => {
    it('returns recording metadata', async () => {
      await enableRecording();
      const session = await createTestSession({ status: 'ended' });
      await insertRecording(session.id);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/recordings/${session.id}/meta`,
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.recording.session_id).toBe(session.id);
      expect(body.recording.event_count).toBe(10);
    });

    it('returns 404 for non-existent recording', async () => {
      await enableRecording();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/recordings/00000000-0000-0000-0000-000000000099/meta',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/recordings/:sessionId', () => {
    it('returns 403 when feature flag is disabled', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/recordings/00000000-0000-0000-0000-000000000001',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 404 for missing recording', async () => {
      await enableRecording();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/recordings/00000000-0000-0000-0000-000000000099',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
