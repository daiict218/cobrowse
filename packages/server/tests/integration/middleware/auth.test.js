import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

// Mock Ably before any app imports
vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn() }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn() }) }; } },
}));

// Mock logger to silence output
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, cleanup, teardown, getTestKeys, getTestTenantId } from '../helpers/setup.js';
import { authenticate, authenticateSecret } from '../../../src/middleware/auth.js';

// We test auth middleware via app.inject() for a clean integration test.
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

describe('authentication middleware', () => {
  const { secretKey, publicKey } = getTestKeys();

  describe('via health endpoint (no auth required)', () => {
    it('health check does not require auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ok');
    });
  });

  describe('secret key auth (sessions endpoint)', () => {
    it('accepts a valid secret key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
        payload: { agentId: 'agent_1', customerId: 'cust_1' },
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects a public key on a secret-only endpoint', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'X-API-Key': publicKey, 'Content-Type': 'application/json' },
        payload: { agentId: 'agent_1', customerId: 'cust_1' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects missing API key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'Content-Type': 'application/json' },
        payload: { agentId: 'agent_1', customerId: 'cust_1' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects invalid API key', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'X-API-Key': 'cb_sk_totally_invalid', 'Content-Type': 'application/json' },
        payload: { agentId: 'agent_1', customerId: 'cust_1' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('public key auth (masking-rules endpoint)', () => {
    it('accepts a valid public key via X-CB-Public-Key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/masking-rules',
        headers: { 'X-CB-Public-Key': publicKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('maskingRules');
    });

    it('rejects missing public key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/masking-rules',
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects invalid public key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/masking-rules',
        headers: { 'X-CB-Public-Key': 'cb_pk_bogus' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('alternate header formats', () => {
    it('accepts X-CB-Secret-Key header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'X-CB-Secret-Key': secretKey, 'Content-Type': 'application/json' },
        payload: { agentId: 'agent_1', customerId: 'cust_1' },
      });
      expect(res.statusCode).toBe(201);
    });
  });
});
