import crypto from 'node:crypto';
import config from '../config.js';

/**
 * Generates a short-lived, HMAC-signed token for customer session reconnects.
 *
 * Format (URL-safe base64): <sessionId>:<customerId>:<expiresAt>:<hmac>
 *
 * The token is stored in the customer's sessionStorage. On page refresh, the SDK
 * presents it to /api/v1/ably-auth to re-authenticate without re-consent.
 *
 * Security properties:
 * - Bound to a specific session and customer — cannot be replayed for another
 * - Has an expiry so stolen tokens become useless after the session window
 * - HMAC prevents forgery without the server-side TOKEN_SECRET
 */
function generateCustomerToken(sessionId, customerId, tenantId) {
  const expiresAt = Date.now() + config.session.maxDurationMinutes * 60 * 1000;
  const payload = `${sessionId}:${customerId}:${tenantId}:${expiresAt}`;
  const hmac = crypto
    .createHmac('sha256', config.security.tokenSecret)
    .update(payload)
    .digest('hex');

  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
}

/**
 * Verifies and decodes a customer token.
 * Returns the payload if valid, throws on invalid/expired.
 */
function verifyCustomerToken(token) {
  let decoded;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new Error('Malformed token');
  }

  const parts = decoded.split(':');
  if (parts.length !== 5) throw new Error('Invalid token structure');

  const [sessionId, customerId, tenantId, expiresAt, providedHmac] = parts;

  const payload = `${sessionId}:${customerId}:${tenantId}:${expiresAt}`;
  const expectedHmac = crypto
    .createHmac('sha256', config.security.tokenSecret)
    .update(payload)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  const hmacBuffer = Buffer.from(providedHmac, 'hex');
  const expectedBuffer = Buffer.from(expectedHmac, 'hex');
  if (
    hmacBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(hmacBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid token signature');
  }

  if (Date.now() > parseInt(expiresAt, 10)) {
    throw new Error('Token expired');
  }

  return { sessionId, customerId, tenantId };
}

/**
 * Hashes an API key for storage. We store only the hash, never the plaintext.
 * Keys are prefixed: cb_sk_ (secret) or cb_pk_ (public) so we can distinguish
 * them without decryption.
 */
function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generates a new secret API key. Prefix cb_sk_ makes it visually identifiable.
 */
function generateSecretKey() {
  return `cb_sk_${crypto.randomBytes(24).toString('hex')}`;
}

/**
 * Generates a new public API key (for SDK embeds). Prefix cb_pk_.
 */
function generatePublicKey() {
  return `cb_pk_${crypto.randomBytes(24).toString('hex')}`;
}

export {
  generateCustomerToken,
  verifyCustomerToken,
  hashApiKey,
  generateSecretKey,
  generatePublicKey,
};
