import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, teardown } from './helpers/setup.js';
import buildApp from '../../src/app.js';

let app;

beforeAll(async () => {
  await setupDatabase();
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await teardown();
});

describe('app', () => {
  describe('health check', () => {
    it('GET /health returns 200 with status ok', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.ts).toBeTruthy();
    });
  });

  describe('error handler', () => {
    it('formats AppError into JSON response', async () => {
      // Trigger a 404 via sessions endpoint
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/sessions/00000000-0000-0000-0000-000000000000',
        headers: { 'X-API-Key': 'cb_sk_invalid_key_for_error_test' },
      });
      // Will get 401 (UnauthorizedError) which is an AppError
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('message');
    });

    it('handles validation errors', async () => {
      // POST with invalid body triggers Fastify validation
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: { 'X-API-Key': 'cb_sk_test_secret_key_for_integration_tests', 'Content-Type': 'application/json' },
        payload: { agentId: '' }, // fails minLength: 1
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('rate limit headers', () => {
    it('includes rate limit headers', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      // Fastify rate limit adds these headers
      expect(res.headers).toHaveProperty('x-ratelimit-limit');
      expect(res.headers).toHaveProperty('x-ratelimit-remaining');
    });
  });

  describe('security headers', () => {
    it('includes Helmet security headers', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers).toHaveProperty('x-content-type-options');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('demo endpoints', () => {
    it('GET /demo returns demo landing page', async () => {
      const res = await app.inject({ method: 'GET', url: '/demo' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('CoBrowse');
    });

    it('GET /demo/config.js returns JS config', async () => {
      const res = await app.inject({ method: 'GET', url: '/demo/config.js' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/javascript');
      expect(res.body).toContain('COBROWSE_DEMO_CONFIG');
    });
  });
});
