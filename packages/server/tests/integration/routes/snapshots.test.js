import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, cleanup, teardown, getTestKeys, createTestSession, getTestTenantId, getPool } from '../helpers/setup.js';
import { generateCustomerToken } from '../../../src/utils/token.js';
import buildApp from '../../../src/app.js';

let app;
const { secretKey } = getTestKeys();

beforeAll(async () => {
  await setupDatabase();
  app = await buildApp();
  await app.ready();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await app.close();
  await teardown();
});

describe('snapshots routes', () => {
  async function createActiveSession() {
    const session = await createTestSession();
    const pool = getPool();
    await pool.query("UPDATE sessions SET status = 'active', customer_joined_at = NOW() WHERE id = $1", [session.id]);
    const customerToken = generateCustomerToken(session.id, session.customer_id, getTestTenantId());
    return { session, customerToken };
  }

  describe('POST /api/v1/snapshots/:sessionId', () => {
    it('stores a snapshot (201)', async () => {
      const { session, customerToken } = await createActiveSession();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/snapshots/${session.id}`,
        headers: { 'Content-Type': 'application/json' },
        payload: {
          snapshot: [{ type: 4, data: {} }, { type: 2, data: { node: {} } }],
          customerToken,
          url: 'https://example.com',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().stored).toBe(true);
    });

    it('rejects invalid customer token', async () => {
      const { session } = await createActiveSession();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/snapshots/${session.id}`,
        headers: { 'Content-Type': 'application/json' },
        payload: { snapshot: [{ type: 2 }], customerToken: 'invalid-token' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects token for wrong session', async () => {
      const { session, customerToken } = await createActiveSession();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/snapshots/00000000-0000-0000-0000-000000000000`,
        headers: { 'Content-Type': 'application/json' },
        payload: { snapshot: [{ type: 2 }], customerToken },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/snapshots/:sessionId', () => {
    it('fetches a stored snapshot', async () => {
      const { session, customerToken } = await createActiveSession();
      // Store first
      await app.inject({
        method: 'POST',
        url: `/api/v1/snapshots/${session.id}`,
        headers: { 'Content-Type': 'application/json' },
        payload: { snapshot: [{ type: 4, data: {} }], customerToken, url: 'https://example.com' },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/snapshots/${session.id}`,
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().snapshot).toBeTruthy();
    });

    it('returns 404 when no snapshot exists', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/snapshots/${session.id}`,
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects without auth', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/snapshots/${session.id}`,
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
