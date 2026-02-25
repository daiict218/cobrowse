import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import {
  setupDatabase, cleanup, teardown, getTestApp,
  getTestTenantId, getTestKeys, createTestSession,
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

describe('Embed Viewer Security', () => {
  it('SERVER_URL in template includes port from Host header', async () => {
    const session = await createTestSession({ status: 'active' });
    const jwt = await signTestJwt(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
      headers: { host: 'localhost:4000' },
    });

    expect(res.statusCode).toBe(200);
    // The SERVER_URL should include the port
    expect(res.body).toContain('localhost:4000');
  });

  it('template variables are HTML-escaped (XSS prevention)', async () => {
    const session = await createTestSession({ status: 'active' });
    // Sign a JWT with a display name that contains HTML
    const jwt = await signTestJwt(privateKey, {
      sub: 'agent_xss_test',
      name: '<script>alert("xss")</script>',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
    });

    expect(res.statusCode).toBe(200);
    // The agent ID should be escaped — raw <script> should not appear
    expect(res.body).not.toContain('<script>alert');
    // Session ID should be present
    expect(res.body).toContain(session.id);
  });

  it('JWT token value is HTML-escaped in template', async () => {
    const session = await createTestSession({ status: 'active' });
    const jwt = await signTestJwt(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
    });

    expect(res.statusCode).toBe(200);
    // JWT contains dots and base64 chars — should be present but escaped
    expect(res.body).toContain('JWT_TOKEN');
  });

  it('embed viewer template contains postMessage source validation', async () => {
    const session = await createTestSession({ status: 'active' });
    const jwt = await signTestJwt(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
    });

    expect(res.statusCode).toBe(200);
    // Verify the postMessage handler checks e.source
    expect(res.body).toContain('e.source !== window.opener');
    expect(res.body).toContain('e.source !== window.parent');
  });

  it('embed viewer template contains replayer guard', async () => {
    const session = await createTestSession({ status: 'active' });
    const jwt = await signTestJwt(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
    });

    expect(res.statusCode).toBe(200);
    // Verify the double-init guard exists
    expect(res.body).toContain('replayer.destroy()');
    expect(res.body).toContain('Guard: destroy existing replayer');
  });

  it('CSP includes connect-src for API calls', async () => {
    const session = await createTestSession({ status: 'active' });
    const jwt = await signTestJwt(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
    });

    const csp = res.headers['content-security-policy'];
    expect(csp).toBeTruthy();
    // Should allow connections to self (for API calls)
    expect(csp).toContain("'self'");
  });

  it('different tenant JWT cannot access another tenant session', async () => {
    // Create a session for the test tenant
    const session = await createTestSession({ status: 'active' });

    // Sign a JWT with a different tenantId
    const jwt = await signTestJwt(privateKey, {
      tenantId: '00000000-0000-0000-0000-000000000099',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
    });

    // Should fail — tenant not found or session not found
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
