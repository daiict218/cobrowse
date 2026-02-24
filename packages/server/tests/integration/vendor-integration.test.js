import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import {
  setupDatabase, cleanup, teardown, getTestApp,
  getTestTenantId, getTestKeys,
  generateTestJwtKeyPair, configureJwtForTestTenant, signTestJwt,
} from './helpers/setup.js';
import { evictKeyCache } from '../../src/middleware/jwt-auth.js';

let app, tenantId, keys;
let publicKeyPem, privateKey;

beforeAll(async () => {
  await setupDatabase();
  app = await getTestApp();
  tenantId = getTestTenantId();
  keys = getTestKeys();

  // Configure JWT
  const kp = await generateTestJwtKeyPair();
  publicKeyPem = kp.publicKeyPem;
  privateKey = kp.privateKey;
  await configureJwtForTestTenant(publicKeyPem);
  evictKeyCache(tenantId);
});

beforeEach(async () => {
  // Re-apply jwt_config before each test to survive cross-file DB interference
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

describe('Vendor Integration E2E', () => {
  it('full flow: JWT auth → create session → get embed page → get ably token → end session', async () => {
    const jwt = await signTestJwt(privateKey, { sub: 'agent_vendor_e2e' });

    // 1. Create session with JWT auth
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { customerId: 'cust_vendor_e2e', agentId: 'agent_vendor_e2e' },
    });
    expect(createRes.statusCode).toBe(201);
    const { sessionId } = JSON.parse(createRes.body);
    expect(sessionId).toBeTruthy();

    // 2. Get session with JWT auth
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(getRes.statusCode).toBe(200);
    const session = JSON.parse(getRes.body);
    expect(session.status).toBe('pending');
    expect(session.agentId).toBe('agent_vendor_e2e');

    // 3. Get embed page with JWT in query param
    const embedRes = await app.inject({
      method: 'GET',
      url: `/embed/session/${sessionId}?token=${encodeURIComponent(jwt)}`,
    });
    expect(embedRes.statusCode).toBe(200);
    expect(embedRes.headers['content-type']).toContain('text/html');
    expect(embedRes.body).toContain(sessionId);

    // 4. Get Ably token with JWT auth
    const ablyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/ably-auth?role=agent&sessionId=${sessionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(ablyRes.statusCode).toBe(200);
    const tokenRequest = JSON.parse(ablyRes.body);
    expect(tokenRequest.keyName).toBeTruthy();

    // 5. End session with JWT auth
    const endRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(endRes.statusCode).toBe(204);

    // 6. Verify session is ended
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { 'x-api-key': keys.secretKey },
    });
    expect(JSON.parse(verifyRes.body).status).toBe('ended');
  });

  it('JWT auth + API key auth coexist — same session', async () => {
    const jwt = await signTestJwt(privateKey, { sub: 'agent_jwt_user' });

    // Create with API key
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'x-api-key': keys.secretKey },
      payload: { agentId: 'agent_jwt_user', customerId: 'cust_mix_test' },
    });
    expect(createRes.statusCode).toBe(201);
    const { sessionId } = JSON.parse(createRes.body);

    // Get with JWT
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(getRes.statusCode).toBe(200);

    // End with JWT
    const endRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(endRes.statusCode).toBe(204);
  });

  it('agentId extracted from JWT sub when not provided in body', async () => {
    const jwt = await signTestJwt(privateKey, { sub: 'agent_from_jwt_sub' });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { customerId: 'cust_auto_agent' },
    });
    expect(createRes.statusCode).toBe(201);

    const { sessionId } = JSON.parse(createRes.body);
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(JSON.parse(getRes.body).agentId).toBe('agent_from_jwt_sub');
  });
});
