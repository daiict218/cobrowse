import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({ keyName: 'test', timestamp: Date.now(), nonce: 'n', capability: '{}' }) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({ keyName: 'test', timestamp: Date.now(), nonce: 'n', capability: '{}' }) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, cleanup, teardown, getTestKeys, createTestSession, getTestTenantId, getPool } from '../helpers/setup.js';
import { generateCustomerToken } from '../../../src/utils/token.js';
import buildApp from '../../../src/app.js';

let app;
const { secretKey, publicKey } = getTestKeys();

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

describe('ably-auth routes', () => {
  describe('role=invite', () => {
    it('returns token request with public key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ably-auth?role=invite&customerId=cust_1',
        headers: { 'X-CB-Public-Key': publicKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('keyName');
    });

    it('requires customerId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ably-auth?role=invite',
        headers: { 'X-CB-Public-Key': publicKey },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects without public key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ably-auth?role=invite&customerId=cust_1',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('role=customer', () => {
    it('returns token request with valid customer token', async () => {
      const session = await createTestSession();
      const pool = getPool();
      await pool.query("UPDATE sessions SET status = 'active' WHERE id = $1", [session.id]);
      const customerToken = generateCustomerToken(session.id, session.customer_id, getTestTenantId());

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/ably-auth?role=customer&sessionId=${session.id}`,
        headers: { 'X-Customer-Token': customerToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it('requires sessionId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ably-auth?role=customer',
        headers: { 'X-Customer-Token': 'test' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects without customer token', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/ably-auth?role=customer&sessionId=${session.id}`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('role=agent', () => {
    it('returns token request with secret key', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/ably-auth?role=agent&sessionId=${session.id}`,
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(200);
    });

    it('requires sessionId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ably-auth?role=agent',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects without secret key', async () => {
      const session = await createTestSession();
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/ably-auth?role=agent&sessionId=${session.id}`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('missing/unknown role', () => {
    it('rejects missing role', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ably-auth',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects unknown role', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/ably-auth?role=spectator',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
