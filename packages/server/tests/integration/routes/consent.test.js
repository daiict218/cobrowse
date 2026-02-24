import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, cleanup, teardown, createTestSession, getPool } from '../helpers/setup.js';
import buildApp from '../../../src/app.js';

let app;

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

describe('consent routes', () => {
  describe('GET /consent/:sessionId', () => {
    it('renders consent page HTML', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'GET',
        url: `/consent/${session.id}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain(session.id);
    });

    it('returns 404 for unknown session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/consent/00000000-0000-0000-0000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 410 for ended session', async () => {
      const session = await createTestSession();
      const pool = getPool();
      await pool.query("UPDATE sessions SET status = 'ended' WHERE id = $1", [session.id]);

      const res = await app.inject({
        method: 'GET',
        url: `/consent/${session.id}`,
      });
      expect(res.statusCode).toBe(410);
      expect(res.body).toContain('ended');
    });
  });

  describe('POST /consent/:sessionId/approve', () => {
    it('approves consent and returns customer token', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'POST',
        url: `/consent/${session.id}/approve`,
        headers: { 'Content-Type': 'application/json' },
        payload: { customerId: session.customer_id },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.approved).toBe(true);
      expect(body.customerToken).toBeTruthy();
      expect(body.sessionId).toBe(session.id);
    });

    it('rejects with wrong customerId', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'POST',
        url: `/consent/${session.id}/approve`,
        headers: { 'Content-Type': 'application/json' },
        payload: { customerId: 'wrong_customer' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('validates required customerId', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'POST',
        url: `/consent/${session.id}/approve`,
        headers: { 'Content-Type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /consent/:sessionId/decline', () => {
    it('declines consent', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'POST',
        url: `/consent/${session.id}/decline`,
        headers: { 'Content-Type': 'application/json' },
        payload: { customerId: session.customer_id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().declined).toBe(true);
    });

    it('rejects with wrong customerId', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'POST',
        url: `/consent/${session.id}/decline`,
        headers: { 'Content-Type': 'application/json' },
        payload: { customerId: 'wrong_customer' },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
