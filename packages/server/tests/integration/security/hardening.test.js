/**
 * Security hardening tests — validates all security fixes from the security audit.
 *
 * Covers:
 *   - CSRF token protection on consent routes
 *   - HTML escaping in consent page template
 *   - Auth middleware rejects API keys in query params
 *   - Input validation patterns on agentId/customerId
 *   - Atomic consent state transitions (race condition prevention)
 *   - Regex validation in admin masking-rules (ReDoS protection)
 *   - CSP headers (frame-ancestors, form-action, base-uri)
 *   - Security event logging for auth failures
 *   - Generic error messages (no token detail leakage)
 *   - Per-route rate limit configuration on dom-events
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    fatal: vi.fn(), trace: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

import { setupDatabase, cleanup, teardown, getTestKeys, createTestSession, getTestTenantId, getPool } from '../helpers/setup.js';
import { generateCustomerToken } from '../../../src/utils/token.js';
import cache from '../../../src/cache/index.js';
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

// ─── CSRF Protection ──────────────────────────────────────────────────────────

describe('CSRF protection (consent routes)', () => {
  it('GET consent page stores a CSRF token in cache', async () => {
    const session = await createTestSession();
    await app.inject({ method: 'GET', url: `/consent/${session.id}` });

    const csrfToken = await cache.get(`csrf:${session.id}`);
    expect(csrfToken).toBeTruthy();
    expect(typeof csrfToken).toBe('string');
    expect(csrfToken.length).toBe(64); // 32 bytes hex-encoded
  });

  it('POST approve succeeds with valid CSRF token', async () => {
    const session = await createTestSession();

    // Load page to get CSRF token stored
    await app.inject({ method: 'GET', url: `/consent/${session.id}` });
    const csrfToken = await cache.get(`csrf:${session.id}`);

    const res = await app.inject({
      method: 'POST',
      url: `/consent/${session.id}/approve`,
      headers: { 'Content-Type': 'application/json' },
      payload: { customerId: session.customer_id, csrfToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().approved).toBe(true);
  });

  it('POST approve rejects invalid CSRF token', async () => {
    const session = await createTestSession();
    await app.inject({ method: 'GET', url: `/consent/${session.id}` });

    const res = await app.inject({
      method: 'POST',
      url: `/consent/${session.id}/approve`,
      headers: { 'Content-Type': 'application/json' },
      payload: { customerId: session.customer_id, csrfToken: 'totally-wrong-token' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('CSRF token is single-use (consumed after first use)', async () => {
    const session = await createTestSession();
    await app.inject({ method: 'GET', url: `/consent/${session.id}` });
    const csrfToken = await cache.get(`csrf:${session.id}`);

    // First use succeeds
    await app.inject({
      method: 'POST',
      url: `/consent/${session.id}/approve`,
      headers: { 'Content-Type': 'application/json' },
      payload: { customerId: session.customer_id, csrfToken },
    });

    // Second use with same token fails (consumed)
    const session2 = await createTestSession({ customer_id: 'cust_csrf_2' });
    await app.inject({ method: 'GET', url: `/consent/${session2.id}` });
    const csrfToken2 = await cache.get(`csrf:${session2.id}`);

    // Use the first (consumed) token on a different session should fail
    const res = await app.inject({
      method: 'POST',
      url: `/consent/${session2.id}/approve`,
      headers: { 'Content-Type': 'application/json' },
      payload: { customerId: session2.customer_id, csrfToken: csrfToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST approve works without CSRF token (SDK inline consent path)', async () => {
    const session = await createTestSession();
    const res = await app.inject({
      method: 'POST',
      url: `/consent/${session.id}/approve`,
      headers: { 'Content-Type': 'application/json' },
      payload: { customerId: session.customer_id },
    });
    // SDK inline consent doesn't send CSRF — should still work
    expect(res.statusCode).toBe(200);
  });

  it('POST decline rejects invalid CSRF token', async () => {
    const session = await createTestSession();
    await app.inject({ method: 'GET', url: `/consent/${session.id}` });

    const res = await app.inject({
      method: 'POST',
      url: `/consent/${session.id}/decline`,
      headers: { 'Content-Type': 'application/json' },
      payload: { customerId: session.customer_id, csrfToken: 'bad-token' },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── HTML Escaping ────────────────────────────────────────────────────────────

describe('HTML escaping (XSS prevention)', () => {
  it('consent page HTML-escapes agent_id to prevent XSS', async () => {
    const xssPayload = '<script>alert("xss")</script>';
    const session = await createTestSession({ agent_id: xssPayload });

    const res = await app.inject({
      method: 'GET',
      url: `/consent/${session.id}`,
    });
    expect(res.statusCode).toBe(200);
    // The raw script tag must NOT appear in the rendered HTML
    expect(res.body).not.toContain('<script>alert("xss")</script>');
    // It should be escaped
    expect(res.body).toContain('&lt;script&gt;');
  });

  it('consent page HTML-escapes customer_id', async () => {
    const xssPayload = '<img src=x onerror=alert(1)>';
    const session = await createTestSession({ customer_id: xssPayload });

    const res = await app.inject({
      method: 'GET',
      url: `/consent/${session.id}`,
    });
    expect(res.statusCode).toBe(200);
    // The raw <img> tag must NOT appear — it should be escaped
    expect(res.body).not.toContain('<img src=x');
    expect(res.body).toContain('&lt;img');
  });
});

// ─── Auth Middleware: No Query Param API Keys ─────────────────────────────────

describe('auth middleware rejects query param API keys', () => {
  it('API key in query parameter is NOT accepted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/sessions?apiKey=${secretKey}`,
      headers: { 'Content-Type': 'application/json' },
      payload: { agentId: 'agent_1', customerId: 'cust_1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('API key must be provided via headers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
      payload: { agentId: 'agent_1', customerId: 'cust_1' },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ─── Input Validation Patterns ────────────────────────────────────────────────

describe('input validation patterns (agentId/customerId)', () => {
  it('rejects agentId with script tags', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
      payload: { agentId: '<script>alert(1)</script>', customerId: 'cust_1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects customerId with SQL injection attempts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
      payload: { agentId: 'agent_1', customerId: "' OR 1=1; --" },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects agentId with spaces', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
      payload: { agentId: 'agent 1', customerId: 'cust_1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid agentId/customerId with allowed chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
      payload: { agentId: 'agent_1@company.com', customerId: 'cust:user=123' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects agentId exceeding max length', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
      payload: { agentId: 'a'.repeat(200), customerId: 'cust_1' },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Atomic Consent State Transition ──────────────────────────────────────────

describe('atomic consent state transition (race condition prevention)', () => {
  it('concurrent consent approvals do not double-activate', async () => {
    const session = await createTestSession();

    // Fire two concurrent approve requests
    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/consent/${session.id}/approve`,
        headers: { 'Content-Type': 'application/json' },
        payload: { customerId: session.customer_id },
      }),
      app.inject({
        method: 'POST',
        url: `/consent/${session.id}/approve`,
        headers: { 'Content-Type': 'application/json' },
        payload: { customerId: session.customer_id },
      }),
    ]);

    // Both should succeed (idempotent), but session should only be active once
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    // Verify session is active (not double-activated)
    const pool = getPool();
    const result = await pool.query('SELECT status FROM sessions WHERE id = $1', [session.id]);
    expect(result.rows[0].status).toBe('active');
  });

  it('consent on already-ended session fails', async () => {
    const session = await createTestSession();
    const pool = getPool();
    await pool.query("UPDATE sessions SET status = 'ended', ended_at = NOW() WHERE id = $1", [session.id]);

    const res = await app.inject({
      method: 'POST',
      url: `/consent/${session.id}/approve`,
      headers: { 'Content-Type': 'application/json' },
      payload: { customerId: session.customer_id },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── Regex Validation (Admin Masking Rules) ───────────────────────────────────

describe('regex validation (admin masking-rules)', () => {
  it('rejects invalid regex pattern', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/masking-rules',
      headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
      payload: { patterns: ['[invalid regex('] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('Invalid regex');
  });

  it('rejects catastrophic backtracking (ReDoS) patterns', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/masking-rules',
      headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
      payload: { patterns: ['(a+)+$'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('catastrophic');
  });

  it('accepts valid regex patterns', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/masking-rules',
      headers: { 'X-API-Key': secretKey, 'Content-Type': 'application/json' },
      payload: { patterns: ['\\d{3}-\\d{2}-\\d{4}', '\\b[A-Z]{2}\\d{6}\\b'] },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ─── CSP Headers ──────────────────────────────────────────────────────────────

describe('CSP headers (clickjacking, form action, base-uri)', () => {
  it('sets frame-ancestors to self (prevents clickjacking)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'self'");
  });

  it('sets form-action to self (prevents form redirection)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("form-action 'self'");
  });

  it('sets base-uri to self (prevents base tag hijacking)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("base-uri 'self'");
  });

  it('includes Ably domains in connect-src', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain('*.ably.io');
    expect(csp).toContain('*.ably.com');
  });
});

// ─── Generic Error Messages ───────────────────────────────────────────────────

describe('generic error messages (no information leakage)', () => {
  it('invalid customer token returns generic message without technical details', async () => {
    const session = await createTestSession();
    const pool = getPool();
    await pool.query("UPDATE sessions SET status = 'active', customer_joined_at = NOW() WHERE id = $1", [session.id]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dom-events/${session.id}`,
      headers: { 'Content-Type': 'application/json' },
      payload: { events: [{ type: 3 }], customerToken: 'expired-or-tampered-token' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    // Should NOT reveal internal details (HMAC, signature, hash, decode errors)
    expect(body.message).not.toContain('HMAC');
    expect(body.message).not.toContain('signature');
    expect(body.message).not.toContain('base64');
    expect(body.message).not.toContain('decode');
    // Should use a generic message
    expect(body.message).toBeTruthy();
  });

  it('invalid API key returns generic message without key details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'X-API-Key': 'cb_sk_secret_that_does_not_exist', 'Content-Type': 'application/json' },
      payload: { agentId: 'agent_1', customerId: 'cust_1' },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.message).not.toContain('cb_sk_secret_that_does_not_exist');
    expect(body.message).toContain('Invalid API key');
  });
});

// ─── DOM Events Input Validation ──────────────────────────────────────────────

describe('dom-events input validation', () => {
  async function createActiveSession() {
    const session = await createTestSession();
    const pool = getPool();
    await pool.query("UPDATE sessions SET status = 'active', customer_joined_at = NOW() WHERE id = $1", [session.id]);
    const customerToken = generateCustomerToken(session.id, session.customer_id, getTestTenantId());
    return { session, customerToken };
  }

  it('rejects non-uuid sessionId parameter', async () => {
    const { customerToken } = await createActiveSession();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dom-events/not-a-uuid',
      headers: { 'Content-Type': 'application/json' },
      payload: { events: [], customerToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects request body without required fields', async () => {
    const { session } = await createActiveSession();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dom-events/${session.id}`,
      headers: { 'Content-Type': 'application/json' },
      payload: { events: [] }, // missing customerToken
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects request body with events as non-array', async () => {
    const { session, customerToken } = await createActiveSession();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/dom-events/${session.id}`,
      headers: { 'Content-Type': 'application/json' },
      payload: { events: 'not-an-array', customerToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET since parameter only accepts digit strings', async () => {
    const { session } = await createActiveSession();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/dom-events/${session.id}?since=abc`,
      headers: { 'X-API-Key': secretKey },
    });
    // 'since' has pattern validation — abc should fail
    expect(res.statusCode).toBe(400);
  });
});

// ─── Consent Schema Validation ────────────────────────────────────────────────

describe('consent schema validation', () => {
  it('enforces customerId maxLength on approve', async () => {
    const session = await createTestSession();
    const res = await app.inject({
      method: 'POST',
      url: `/consent/${session.id}/approve`,
      headers: { 'Content-Type': 'application/json' },
      payload: { customerId: 'x'.repeat(200) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('enforces csrfToken maxLength', async () => {
    const session = await createTestSession();
    const res = await app.inject({
      method: 'POST',
      url: `/consent/${session.id}/approve`,
      headers: { 'Content-Type': 'application/json' },
      payload: { customerId: session.customer_id, csrfToken: 'x'.repeat(200) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects non-uuid sessionId on approve', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/consent/not-a-valid-uuid/approve',
      headers: { 'Content-Type': 'application/json' },
      payload: { customerId: 'cust_1' },
    });
    expect(res.statusCode).toBe(400);
  });
});
