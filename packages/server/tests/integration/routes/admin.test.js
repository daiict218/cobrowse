import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, cleanup, teardown, getTestKeys, createTestSession, getTestTenantId } from '../helpers/setup.js';
import { logEvent } from '../../../src/services/audit.js';
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

describe('admin routes', () => {
  describe('GET /api/v1/admin/masking-rules', () => {
    it('returns masking rules with secret key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/masking-rules',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('maskingRules');
    });

    it('rejects without auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/masking-rules',
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('PUT /api/v1/admin/masking-rules', () => {
    it('updates masking rules', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/masking-rules',
        headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
        payload: { selectors: ['input[name="ssn"]'], maskTypes: ['password', 'tel', 'email'] },
      });
      expect(res.statusCode).toBe(200);
      const rules = res.json().maskingRules;
      expect(rules.selectors).toContain('input[name="ssn"]');
      expect(rules.maskTypes).toContain('email');
    });

    it('validates maskTypes enum', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/masking-rules',
        headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
        payload: { maskTypes: ['invalid-type'] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/admin/audit/export', () => {
    it('exports audit events as CSV', async () => {
      const session = await createTestSession();
      await logEvent({ sessionId: session.id, tenantId: getTestTenantId(), eventType: 'session.created', actor: 'agent' });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit/export',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.body).toContain('session_id');
      expect(res.body).toContain('session.created');
    });

    it('returns 204 when no events', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/audit/export',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(204);
    });
  });

  describe('GET /api/v1/admin/feature-flags', () => {
    it('returns feature flags', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/feature-flags',
        headers: { 'X-API-Key': secretKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('featureFlags');
    });
  });
});

describe('public routes', () => {
  describe('GET /api/v1/public/masking-rules', () => {
    it('returns masking rules with public key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/masking-rules',
        headers: { 'X-CB-Public-Key': publicKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveProperty('maskingRules');
    });
  });

  describe('GET /api/v1/public/pending-activation', () => {
    it('returns null sessionId when no pending session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/pending-activation?customerId=cust_nobody',
        headers: { 'X-CB-Public-Key': publicKey },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().sessionId).toBeNull();
    });

    it('returns pending session info', async () => {
      const session = await createTestSession({ customer_id: 'cust_poll_test' });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/pending-activation?customerId=cust_poll_test',
        headers: { 'X-CB-Public-Key': publicKey },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.sessionId).toBe(session.id);
      expect(body.status).toBe('pending');
    });

    it('requires customerId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/pending-activation',
        headers: { 'X-CB-Public-Key': publicKey },
      });
      expect(res.statusCode).toBe(400);
    });

    it('requires public key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/public/pending-activation?customerId=cust_1',
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
