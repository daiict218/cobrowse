import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, cleanup, teardown, getTestKeys, createTestSession, getTestTenantId } from '../helpers/setup.js';
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

describe('sessions routes', () => {
  describe('POST /api/v1/sessions', () => {
    it('creates a session (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
        payload: { agentId: 'agent_1', customerId: 'cust_1' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.sessionId).toBeTruthy();
      expect(body.status).toBe('pending');
      expect(body.inviteUrl).toContain('/consent/');
    });

    it('validates required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
        payload: { agentId: 'agent_1' }, // missing customerId
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects without auth', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'Content-Type': 'application/json' },
        payload: { agentId: 'a', customerId: 'c' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/sessions/:id', () => {
    it('returns session details (200)', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/sessions/${session.id}`,
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().sessionId).toBe(session.id);
    });

    it('returns 404 for unknown session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/sessions/00000000-0000-0000-0000-000000000000',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/v1/sessions/:id', () => {
    it('ends a session (204)', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/sessions/${session.id}`,
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(204);
    });

    it('is idempotent', async () => {
      const session = await createTestSession();
      await app.inject({ method: 'DELETE', url: `/api/v1/sessions/${session.id}`, headers: { 'X-API-Key': secretKey } });
      const res = await app.inject({ method: 'DELETE', url: `/api/v1/sessions/${session.id}`, headers: { 'X-API-Key': secretKey } });
      expect(res.statusCode).toBe(204);
    });
  });
});
