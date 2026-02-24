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

describe('dom-events routes', () => {
  async function createActiveSession() {
    const session = await createTestSession();
    const pool = getPool();
    await pool.query("UPDATE sessions SET status = 'active', customer_joined_at = NOW() WHERE id = $1", [session.id]);
    const customerToken = generateCustomerToken(session.id, session.customer_id, getTestTenantId());
    return { session, customerToken };
  }

  describe('POST /api/v1/dom-events/:sessionId', () => {
    it('buffers DOM events (200)', async () => {
      const { session, customerToken } = await createActiveSession();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dom-events/${session.id}`,
        headers: { 'Content-Type': 'application/json' },
        payload: { events: [{ type: 3 }, { type: 3 }], customerToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().buffered).toBe(2);
    });

    it('rejects invalid token', async () => {
      const { session } = await createActiveSession();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dom-events/${session.id}`,
        headers: { 'Content-Type': 'application/json' },
        payload: { events: [{ type: 3 }], customerToken: 'bad-token' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('handles empty events array', async () => {
      const { session, customerToken } = await createActiveSession();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/dom-events/${session.id}`,
        headers: { 'Content-Type': 'application/json' },
        payload: { events: [], customerToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().buffered).toBe(0);
    });
  });

  describe('GET /api/v1/dom-events/:sessionId', () => {
    it('returns buffered events', async () => {
      const { session, customerToken } = await createActiveSession();

      // Buffer some events first
      await app.inject({
        method: 'POST',
        url: `/api/v1/dom-events/${session.id}`,
        headers: { 'Content-Type': 'application/json' },
        payload: { events: [{ type: 3, data: 'e1' }, { type: 3, data: 'e2' }], customerToken },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/dom-events/${session.id}?since=0`,
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().events.length).toBe(2);
      expect(res.json().nextSeq).toBe(2);
    });

    it('returns events since a given sequence', async () => {
      const { session, customerToken } = await createActiveSession();

      await app.inject({
        method: 'POST',
        url: `/api/v1/dom-events/${session.id}`,
        headers: { 'Content-Type': 'application/json' },
        payload: { events: [{ n: 1 }, { n: 2 }, { n: 3 }], customerToken },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/dom-events/${session.id}?since=1`,
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.json().events.length).toBe(2);
    });

    it('rejects without auth', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/dom-events/${session.id}`,
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
