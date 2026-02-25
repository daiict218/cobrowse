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

  // Generate and configure JWT for test tenant
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

describe('Embed Viewer Routes', () => {
  it('GET /embed/session/:id?token=VALID returns 200 with HTML', async () => {
    const session = await createTestSession({ status: 'active' });
    const jwt = await signTestJwt(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('CoBrowse');
    expect(res.body).toContain(session.id);
  });

  it('no token returns 401', async () => {
    const session = await createTestSession({ status: 'active' });

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('invalid JWT returns 401', async () => {
    const session = await createTestSession({ status: 'active' });

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=invalid.jwt.token`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('session not found returns 404', async () => {
    const jwt = await signTestJwt(privateKey);
    const fakeId = '00000000-0000-0000-0000-000000000099';

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${fakeId}?token=${encodeURIComponent(jwt)}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('ended session returns 410', async () => {
    const session = await createTestSession({ status: 'ended' });
    const jwt = await signTestJwt(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
    });

    expect(res.statusCode).toBe(410);
  });

  it('CSP frame-ancestors includes tenant allowed_domains', async () => {
    const session = await createTestSession({ status: 'active' });
    const jwt = await signTestJwt(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
    });

    const csp = res.headers['content-security-policy'];
    expect(csp).toContain('frame-ancestors');
    expect(csp).toContain('localhost');
    expect(csp).toContain('example.com');
  });

  it('script nonce is present in response HTML', async () => {
    const session = await createTestSession({ status: 'active' });
    const jwt = await signTestJwt(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
    });

    // The script tag should have a nonce attribute (set by Helmet)
    expect(res.body).toMatch(/nonce="[A-Za-z0-9+/=]+"/);
  });

  it('X-Frame-Options header is removed', async () => {
    const session = await createTestSession({ status: 'active' });
    const jwt = await signTestJwt(privateKey);

    const res = await app.inject({
      method: 'GET',
      url: `/embed/session/${session.id}?token=${encodeURIComponent(jwt)}`,
    });

    expect(res.headers['x-frame-options']).toBeUndefined();
  });
});
