import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { generateKeyPair, exportSPKI, SignJWT } from 'jose';

// We test the JWT auth middleware in isolation by importing it directly
// and mocking the DB queries.

let authenticateJwt, evictKeyCache, _keyCache;
let mockDbQuery;

// Generate a test RS256 key pair once
let publicKeyPem, privateKey, wrongPrivateKey;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  publicKeyPem = await exportSPKI(kp.publicKey);
  privateKey = kp.privateKey;

  const wrongKp = await generateKeyPair('RS256');
  wrongPrivateKey = wrongKp.privateKey;

  // Mock the DB module
  mockDbQuery = vi.fn();
  vi.doMock('../../../src/db/index.js', () => ({
    query: mockDbQuery,
  }));

  // Import after mocking
  const mod = await import('../../../src/middleware/jwt-auth.js');
  authenticateJwt = mod.authenticateJwt;
  evictKeyCache = mod.evictKeyCache;
  _keyCache = mod._keyCache;
});

afterEach(() => {
  vi.clearAllMocks();
  _keyCache.clear();
});

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

function makeTenantRow(overrides = {}) {
  return {
    id: TENANT_ID,
    name: 'Test Tenant',
    allowed_domains: ['localhost'],
    masking_rules: {},
    feature_flags: {},
    is_active: true,
    jwt_config: { publicKeyPem },
    ...overrides,
  };
}

async function signJwt(claims = {}, key = privateKey) {
  const { sub = 'agent_test', tenantId = TENANT_ID, ...rest } = claims;
  return new SignJWT({ tenantId, ...rest })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
}

function makeRequest(token) {
  return {
    headers: { authorization: `Bearer ${token}` },
    query: {},
  };
}

describe('JWT Auth Middleware', () => {
  it('valid JWT passes and populates request.tenant + request.agent', async () => {
    const token = await signJwt();
    mockDbQuery.mockResolvedValue({ rows: [makeTenantRow()] });

    const request = makeRequest(token);
    await authenticateJwt(request);

    expect(request.tenant.id).toBe(TENANT_ID);
    expect(request.tenant.keyType).toBe('jwt');
    expect(request.agent.id).toBe('agent_test');
  });

  it('expired JWT throws UnauthorizedError', async () => {
    const token = await new SignJWT({ tenantId: TENANT_ID })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('agent_test')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);

    mockDbQuery.mockResolvedValue({ rows: [makeTenantRow()] });

    const request = makeRequest(token);
    await expect(authenticateJwt(request)).rejects.toThrow(/JWT verification failed/);
  });

  it('JWT signed with wrong key throws', async () => {
    const token = await signJwt({}, wrongPrivateKey);
    mockDbQuery.mockResolvedValue({ rows: [makeTenantRow()] });

    const request = makeRequest(token);
    await expect(authenticateJwt(request)).rejects.toThrow(/JWT verification failed/);
  });

  it('wrong tenantId throws (tenant not found)', async () => {
    const token = await signJwt({ tenantId: '00000000-0000-0000-0000-000000000099' });
    mockDbQuery.mockResolvedValue({ rows: [] });

    const request = makeRequest(token);
    await expect(authenticateJwt(request)).rejects.toThrow('Tenant not found');
  });

  it('missing sub claim throws', async () => {
    // Sign a JWT without sub
    const token = await new SignJWT({ tenantId: TENANT_ID })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    mockDbQuery.mockResolvedValue({ rows: [makeTenantRow()] });

    const request = makeRequest(token);
    await expect(authenticateJwt(request)).rejects.toThrow(/sub claim/);
  });

  it('tenant with no jwt_config throws', async () => {
    const token = await signJwt();
    mockDbQuery.mockResolvedValue({ rows: [makeTenantRow({ jwt_config: null })] });

    const request = makeRequest(token);
    await expect(authenticateJwt(request)).rejects.toThrow('JWT authentication not configured');
  });

  it('wrong audience throws when tenant requires it', async () => {
    const token = await signJwt();
    mockDbQuery.mockResolvedValue({
      rows: [makeTenantRow({ jwt_config: { publicKeyPem, audience: 'cobrowse' } })],
    });

    const request = makeRequest(token);
    await expect(authenticateJwt(request)).rejects.toThrow(/JWT verification failed/);
  });

  it('wrong issuer throws when tenant requires it', async () => {
    const token = await signJwt();
    mockDbQuery.mockResolvedValue({
      rows: [makeTenantRow({ jwt_config: { publicKeyPem, issuer: 'expected-issuer' } })],
    });

    const request = makeRequest(token);
    await expect(authenticateJwt(request)).rejects.toThrow(/JWT verification failed/);
  });

  it('malformed token string throws', async () => {
    const request = makeRequest('not.a.valid.jwt');
    await expect(authenticateJwt(request)).rejects.toThrow();
  });

  it('no token throws', async () => {
    const request = { headers: {}, query: {} };
    await expect(authenticateJwt(request)).rejects.toThrow('JWT required');
  });

  it('key cache eviction works', async () => {
    const token = await signJwt();
    mockDbQuery.mockResolvedValue({ rows: [makeTenantRow()] });

    const request = makeRequest(token);
    await authenticateJwt(request);
    expect(_keyCache.has(TENANT_ID)).toBe(true);

    evictKeyCache(TENANT_ID);
    expect(_keyCache.has(TENANT_ID)).toBe(false);
  });

  it('extracts token from ?token= query param', async () => {
    const token = await signJwt();
    mockDbQuery.mockResolvedValue({ rows: [makeTenantRow()] });

    const request = { headers: {}, query: { token } };
    await authenticateJwt(request);

    expect(request.tenant.id).toBe(TENANT_ID);
    expect(request.agent.id).toBe('agent_test');
  });
});
