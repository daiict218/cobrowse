import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, teardown } from '../helpers/setup.js';
import buildApp from '../../../src/app.js';
import * as db from '../../../src/db/index.js';

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

describe('/health/ready', () => {
  it('returns 200 with status ok when all checks pass', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.checks.db).toBe('ok');
    expect(body.checks.cache).toBe('ok');
    expect(body.ts).toBeTruthy();
  });

  it('includes all expected fields in response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    const body = res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('checks');
    expect(body).toHaveProperty('ts');
    expect(body.checks).toHaveProperty('db');
    expect(body.checks).toHaveProperty('cache');
  });

  it('does not require authentication', async () => {
    // No X-API-Key header — should still succeed
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
  });

  it('returns valid ISO timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    const body = res.json();
    const parsed = new Date(body.ts);
    expect(parsed.toISOString()).toBe(body.ts);
  });

  it('includes rate limit headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.headers).toHaveProperty('x-ratelimit-limit');
  });
});

describe('/health/ready — degraded mode', () => {
  it('returns 503 when DB is unreachable', async () => {
    const spy = vi.spyOn(db, 'query').mockRejectedValue(new Error('connection refused'));

    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.db).toBe('error');
    // cache should still be ok (in-memory in test env)
    expect(body.checks.cache).toBe('ok');

    spy.mockRestore();
  });

  it('recovers after DB comes back', async () => {
    const spy = vi.spyOn(db, 'query').mockRejectedValue(new Error('connection refused'));

    let res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);

    // Restore and verify recovery
    spy.mockRestore();
    res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
});
