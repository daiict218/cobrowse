import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config before importing token utils
vi.mock('../../../src/config.js', () => ({
  default: {
    security: { tokenSecret: 'test-secret-key-that-is-long-enough' },
    session: { maxDurationMinutes: 120 },
  },
}));

const {
  generateCustomerToken,
  verifyCustomerToken,
  hashApiKey,
  generateSecretKey,
  generatePublicKey,
} = await import('../../../src/utils/token.js');

describe('generateCustomerToken', () => {
  it('returns a base64url string', () => {
    const token = generateCustomerToken('sess-1', 'cust-1', 'tenant-1');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    // base64url has no +, /, or =
    expect(token).not.toMatch(/[+/=]/);
  });

  it('encodes sessionId, customerId, tenantId', () => {
    const token = generateCustomerToken('sess-1', 'cust-1', 'tenant-1');
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    expect(parts[0]).toBe('sess-1');
    expect(parts[1]).toBe('cust-1');
    expect(parts[2]).toBe('tenant-1');
    expect(parts.length).toBe(5); // sessionId:customerId:tenantId:expiresAt:hmac
  });

  it('sets expiry in the future', () => {
    const token = generateCustomerToken('s', 'c', 't');
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const expiresAt = parseInt(decoded.split(':')[3], 10);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });
});

describe('verifyCustomerToken', () => {
  it('verifies a valid token', () => {
    const token = generateCustomerToken('sess-1', 'cust-1', 'tenant-1');
    const payload = verifyCustomerToken(token);
    expect(payload.sessionId).toBe('sess-1');
    expect(payload.customerId).toBe('cust-1');
    expect(payload.tenantId).toBe('tenant-1');
  });

  it('rejects a tampered token', () => {
    const token = generateCustomerToken('sess-1', 'cust-1', 'tenant-1');
    // Tamper with one character
    const tampered = token.slice(0, -2) + 'xx';
    expect(() => verifyCustomerToken(tampered)).toThrow();
  });

  it('rejects a malformed token (not base64url)', () => {
    expect(() => verifyCustomerToken('not-valid-base64!!!###')).toThrow();
  });

  it('rejects a token with wrong number of parts', () => {
    const bad = Buffer.from('a:b:c').toString('base64url');
    expect(() => verifyCustomerToken(bad)).toThrow('Invalid token structure');
  });

  it('rejects an expired token', () => {
    // Create token, then advance time past expiry
    const token = generateCustomerToken('s', 'c', 't');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 200 * 60 * 1000); // 200 min > 120 min max
    expect(() => verifyCustomerToken(token)).toThrow('Token expired');
    vi.useRealTimers();
  });
});

describe('hashApiKey', () => {
  it('returns a 64-char hex string (SHA-256)', () => {
    const hash = hashApiKey('cb_sk_test123');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashApiKey('cb_sk_test')).toBe(hashApiKey('cb_sk_test'));
  });

  it('produces different hashes for different keys', () => {
    expect(hashApiKey('cb_sk_a')).not.toBe(hashApiKey('cb_sk_b'));
  });
});

describe('generateSecretKey', () => {
  it('starts with cb_sk_ prefix', () => {
    expect(generateSecretKey()).toMatch(/^cb_sk_[0-9a-f]+$/);
  });

  it('generates unique keys', () => {
    const a = generateSecretKey();
    const b = generateSecretKey();
    expect(a).not.toBe(b);
  });

  it('has correct length (prefix + 48 hex chars)', () => {
    // 24 random bytes = 48 hex chars
    expect(generateSecretKey().length).toBe(6 + 48); // cb_sk_ = 6
  });
});

describe('generatePublicKey', () => {
  it('starts with cb_pk_ prefix', () => {
    expect(generatePublicKey()).toMatch(/^cb_pk_[0-9a-f]+$/);
  });

  it('generates unique keys', () => {
    expect(generatePublicKey()).not.toBe(generatePublicKey());
  });
});
