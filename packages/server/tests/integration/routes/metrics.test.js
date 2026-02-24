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

describe('GET /metrics', () => {
  it('returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
  });

  it('returns Prometheus text format content type', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.headers['content-type']).toContain('text/plain');
  });

  it('includes HTTP request metrics', async () => {
    // Make a request first to generate data
    await app.inject({ method: 'GET', url: '/health' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.payload;
    expect(body).toContain('http_requests_total');
    expect(body).toContain('http_request_duration_seconds');
  });

  it('includes session lifecycle metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.payload;
    expect(body).toContain('cobrowse_session_lifecycle_total');
  });

  it('includes database metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.payload;
    expect(body).toContain('cobrowse_db_query_duration_seconds');
    expect(body).toContain('cobrowse_db_query_errors_total');
  });

  it('includes cache metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.payload;
    expect(body).toContain('cobrowse_cache_operations_total');
  });

  it('includes default process metrics', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.payload;
    expect(body).toContain('process_cpu_');
    expect(body).toContain('nodejs_heap_size_total_bytes');
  });

  it('does not require authentication', async () => {
    // No X-API-Key header — should succeed
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
  });

  it('uses route pattern in labels (not actual path)', async () => {
    // Hit a parameterised route
    await app.inject({ method: 'GET', url: '/health/ready' });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    const body = res.payload;
    // Should see /health/ready as the route, not a UUID path
    expect(body).toContain('/health/ready');
  });
});
