import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import * as db from '../db/index.js';
import { UnauthorizedError } from '../utils/errors.js';
import logger from '../utils/logger.js';

const BCRYPT_ROUNDS = 12;
const SESSION_TTL_HOURS = 24;

/**
 * Hash a plaintext password with bcrypt.
 */
async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 */
async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * Authenticate a vendor portal user by email + password.
 * Creates a DB-backed session row and returns the session ID + user info.
 */
async function login(email, password, { ip, userAgent } = {}) {
  // Cleanup expired sessions opportunistically
  cleanupExpiredSessions().catch((err) =>
    logger.warn({ err }, 'vendor-auth: expired session cleanup failed')
  );

  const result = await db.query(
    `SELECT vu.id, vu.vendor_id, vu.email, vu.name, vu.role, vu.password_hash, vu.is_active,
            v.name AS vendor_name, v.is_active AS vendor_active
     FROM vendor_users vu
     JOIN vendors v ON v.id = vu.vendor_id
     WHERE vu.email = $1`,
    [email]
  );

  if (!result.rows.length) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const user = result.rows[0];

  if (!user.is_active) {
    throw new UnauthorizedError('Account is disabled');
  }
  if (!user.vendor_active) {
    throw new UnauthorizedError('Vendor account is disabled');
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  // Create session
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO portal_sessions (id, vendor_user_id, vendor_id, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, user.id, user.vendor_id, ip || null, userAgent || null, expiresAt]
  );

  // Update last login
  await db.query(
    `UPDATE vendor_users SET last_login_at = NOW() WHERE id = $1`,
    [user.id]
  );

  return {
    sessionId,
    expiresAt,
    user: {
      id: user.id,
      vendorId: user.vendor_id,
      vendorName: user.vendor_name,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  };
}

/**
 * Validate a portal session by ID.
 * Returns user info if session is valid, throws UnauthorizedError otherwise.
 */
async function validateSession(sessionId) {
  if (!sessionId) throw new UnauthorizedError('Session required');

  const result = await db.query(
    `SELECT ps.id AS session_id, ps.expires_at,
            vu.id AS user_id, vu.vendor_id, vu.email, vu.name, vu.role, vu.is_active AS user_active,
            v.name AS vendor_name, v.is_active AS vendor_active
     FROM portal_sessions ps
     JOIN vendor_users vu ON vu.id = ps.vendor_user_id
     JOIN vendors v ON v.id = ps.vendor_id
     WHERE ps.id = $1`,
    [sessionId]
  );

  if (!result.rows.length) {
    throw new UnauthorizedError('Invalid or expired session');
  }

  const row = result.rows[0];

  if (new Date(row.expires_at) < new Date()) {
    // Clean up expired session
    await db.query('DELETE FROM portal_sessions WHERE id = $1', [sessionId]);
    throw new UnauthorizedError('Session expired');
  }

  if (!row.user_active) {
    throw new UnauthorizedError('Account is disabled');
  }
  if (!row.vendor_active) {
    throw new UnauthorizedError('Vendor account is disabled');
  }

  return {
    id: row.user_id,
    vendorId: row.vendor_id,
    vendorName: row.vendor_name,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

/**
 * Destroy a portal session (logout).
 */
async function logout(sessionId) {
  if (!sessionId) return;
  await db.query('DELETE FROM portal_sessions WHERE id = $1', [sessionId]);
}

/**
 * Delete all expired portal sessions.
 */
async function cleanupExpiredSessions() {
  const result = await db.query(
    'DELETE FROM portal_sessions WHERE expires_at < NOW()'
  );
  if (result.rowCount > 0) {
    logger.info({ count: result.rowCount }, 'vendor-auth: cleaned up expired sessions');
  }
}

export {
  hashPassword,
  verifyPassword,
  login,
  validateSession,
  logout,
  cleanupExpiredSessions,
};
