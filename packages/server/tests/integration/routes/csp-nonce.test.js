import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, teardown, getTestKeys } from '../helpers/setup.js';
import buildApp from '../../../src/app.js';

let app;
let keys;

beforeAll(async () => {
  await setupDatabase();
  app = await buildApp();
  await app.ready();
  keys = getTestKeys();
});

afterAll(async () => {
  await app.close();
  await teardown();
});

describe('CSP nonce-based security', () => {
  it('includes nonce in CSP script-src header', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
  });

  it('does NOT include unsafe-inline in script-src', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const csp = res.headers['content-security-policy'];
    // script-src should not have unsafe-inline
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it('blocks inline event handlers via script-src-attr none', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const csp = res.headers['content-security-policy'];
    // Helmet default: script-src-attr 'none' blocks onclick= handlers
    expect(csp).toContain("script-src-attr 'none'");
  });

  it('generates a different nonce per request', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/health' });
    const res2 = await app.inject({ method: 'GET', url: '/health' });

    const nonce1 = res1.headers['content-security-policy'].match(/nonce-([A-Za-z0-9+/=]+)/)?.[1];
    const nonce2 = res2.headers['content-security-policy'].match(/nonce-([A-Za-z0-9+/=]+)/)?.[1];

    expect(nonce1).toBeTruthy();
    expect(nonce2).toBeTruthy();
    expect(nonce1).not.toBe(nonce2);
  });

  it('keeps unsafe-inline in style-src (needed for rrweb)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const csp = res.headers['content-security-policy'];
    const styleSrc = csp.split(';').find((d) => d.trim().startsWith('style-src'));
    expect(styleSrc).toContain("'unsafe-inline'");
  });
});

describe('consent page nonce', () => {
  let sessionId;

  beforeAll(async () => {
    // Create a session so we can request the consent page
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sessions',
      headers: { 'X-API-Key': keys.secretKey, 'Content-Type': 'application/json' },
      payload: { agentId: 'agent_csp_test', customerId: 'cust_csp_test' },
    });
    sessionId = createRes.json().sessionId;
  });

  it('includes nonce attribute on the inline script tag', async () => {
    const res = await app.inject({ method: 'GET', url: `/consent/${sessionId}` });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    // Script tag should have nonce="..."
    expect(html).toMatch(/<script nonce="[A-Za-z0-9+/=]+">/);
  });

  it('consent page nonce matches the CSP header nonce', async () => {
    const res = await app.inject({ method: 'GET', url: `/consent/${sessionId}` });
    const csp = res.headers['content-security-policy'];
    const headerNonce = csp.match(/nonce-([A-Za-z0-9+/=]+)/)?.[1];

    const htmlNonce = res.body.match(/<script nonce="([A-Za-z0-9+/=]+)">/)?.[1];

    expect(headerNonce).toBeTruthy();
    expect(htmlNonce).toBeTruthy();
    expect(htmlNonce).toBe(headerNonce);
  });

  it('does not contain {{NONCE}} placeholder in rendered HTML', async () => {
    const res = await app.inject({ method: 'GET', url: `/consent/${sessionId}` });
    expect(res.body).not.toContain('{{NONCE}}');
  });
});
