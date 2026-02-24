import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import {
  setupDatabase, cleanup, teardown, getTestApp,
  getTestTenantId, getTestKeys, getPool,
  generateTestJwtKeyPair,
} from '../helpers/setup.js';
import { evictKeyCache } from '../../../src/middleware/jwt-auth.js';

let app, tenantId, keys;

beforeAll(async () => {
  await setupDatabase();
  app = await getTestApp();
  tenantId = getTestTenantId();
  keys = getTestKeys();
});

afterEach(async () => {
  // Reset jwt_config after each test
  await getPool().query('UPDATE tenants SET jwt_config = NULL WHERE id = $1', [tenantId]);
  evictKeyCache(tenantId);
  await cleanup();
});

afterAll(async () => {
  await teardown();
});

describe('Admin JWT Config Routes', () => {
  it('PUT /api/v1/admin/jwt-config with valid PEM returns 200', async () => {
    const { publicKeyPem } = await generateTestJwtKeyPair();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/jwt-config',
      headers: { 'x-api-key': keys.secretKey },
      payload: { publicKeyPem },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jwtConfig.publicKeyPem).toBe('(set)');
  });

  it('PUT with invalid PEM returns 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/jwt-config',
      headers: { 'x-api-key': keys.secretKey },
      payload: { publicKeyPem: 'not-a-valid-pem' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('PUT without secret key returns 401', async () => {
    const { publicKeyPem } = await generateTestJwtKeyPair();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/jwt-config',
      payload: { publicKeyPem },
    });

    expect(res.statusCode).toBe(401);
  });

  it('DELETE /api/v1/admin/jwt-config returns 204', async () => {
    // First configure it
    const { publicKeyPem } = await generateTestJwtKeyPair();
    await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/jwt-config',
      headers: { 'x-api-key': keys.secretKey },
      payload: { publicKeyPem },
    });

    // Now delete
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/admin/jwt-config',
      headers: { 'x-api-key': keys.secretKey },
    });

    expect(res.statusCode).toBe(204);

    // Verify it's gone
    const pool = getPool();
    const row = await pool.query('SELECT jwt_config FROM tenants WHERE id = $1', [tenantId]);
    expect(row.rows[0].jwt_config).toBeNull();
  });

  it('PUT with issuer and audience stores them', async () => {
    const { publicKeyPem } = await generateTestJwtKeyPair();

    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/jwt-config',
      headers: { 'x-api-key': keys.secretKey },
      payload: { publicKeyPem, issuer: 'sprinklr', audience: 'cobrowse' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jwtConfig.issuer).toBe('sprinklr');
    expect(body.jwtConfig.audience).toBe('cobrowse');
  });
});
