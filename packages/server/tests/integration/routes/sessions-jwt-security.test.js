import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import {
  setupDatabase, cleanup, teardown, getTestApp,
  getTestTenantId, getTestKeys,
  generateTestJwtKeyPair, configureJwtForTestTenant, signTestJwt,
} from '../helpers/setup.js';
import { evictKeyCache } from '../../../src/middleware/jwt-auth.js';

let app, tenantId, keys;
let publicKeyPem, privateKey;

beforeAll(async () => {
  await setupDatabase();
  app = await getTestApp();
  tenantId = getTestTenantId();
  keys = getTestKeys();

  const kp = await generateTestJwtKeyPair();
  publicKeyPem = kp.publicKeyPem;
  privateKey = kp.privateKey;
  await configureJwtForTestTenant(publicKeyPem);
  evictKeyCache(tenantId);
});

beforeEach(async () => {
  await configureJwtForTestTenant(publicKeyPem);
  evictKeyCache(tenantId);
});

afterEach(async () => {
  await cleanup();
  evictKeyCache(tenantId);
});

afterAll(async () => {
  await teardown();
});

describe('Session JWT Security', () => {
  it('JWT sub takes precedence over body.agentId (prevents impersonation)', async () => {
    const jwt = await signTestJwt(privateKey, { sub: 'agent_real_identity' });

    // Try to impersonate a different agent via body.agentId
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { customerId: 'cust_impersonation_test', agentId: 'agent_impersonated' },
    });
    expect(createRes.statusCode).toBe(201);

    const { sessionId } = JSON.parse(createRes.body);

    // Verify the session was created with the JWT identity, not the body value
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const session = JSON.parse(getRes.body);
    expect(session.agentId).toBe('agent_real_identity');
    expect(session.agentId).not.toBe('agent_impersonated');
  });

  it('API key auth still uses body.agentId (no request.agent)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'x-api-key': keys.secretKey },
      payload: { customerId: 'cust_apikey_test', agentId: 'agent_from_body' },
    });
    expect(createRes.statusCode).toBe(201);

    const { sessionId } = JSON.parse(createRes.body);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { 'x-api-key': keys.secretKey },
    });
    expect(JSON.parse(getRes.body).agentId).toBe('agent_from_body');
  });

  it('JWT auth without body.agentId uses JWT sub', async () => {
    const jwt = await signTestJwt(privateKey, { sub: 'agent_jwt_only' });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { customerId: 'cust_jwt_only' },
    });
    expect(createRes.statusCode).toBe(201);

    const { sessionId } = JSON.parse(createRes.body);
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(JSON.parse(getRes.body).agentId).toBe('agent_jwt_only');
  });

  it('API key auth without agentId in body returns validation error', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'x-api-key': keys.secretKey },
      payload: { customerId: 'cust_no_agent' },
    });
    expect(createRes.statusCode).toBe(400);
  });

  it('public key cannot access session endpoints', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'x-api-key': keys.publicKey },
      payload: { customerId: 'cust_test', agentId: 'agent_test' },
    });
    expect(res.statusCode).toBe(401);
  });
});
