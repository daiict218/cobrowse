import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module
vi.mock('../../../src/db/index.js', () => ({
  query: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$2b$12$mockedhash'),
    compare: vi.fn(),
  },
}));

import * as db from '../../../src/db/index.js';
import bcrypt from 'bcrypt';
import {
  hashPassword,
  verifyPassword,
  login,
  validateSession,
  logout,
  cleanupExpiredSessions,
} from '../../../src/services/vendor-auth.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('vendor-auth service', () => {
  describe('hashPassword', () => {
    it('calls bcrypt.hash with 12 rounds', async () => {
      await hashPassword('test123');
      expect(bcrypt.hash).toHaveBeenCalledWith('test123', 12);
    });

    it('returns the hash', async () => {
      const hash = await hashPassword('test123');
      expect(hash).toBe('$2b$12$mockedhash');
    });
  });

  describe('verifyPassword', () => {
    it('calls bcrypt.compare', async () => {
      bcrypt.compare.mockResolvedValue(true);
      const result = await verifyPassword('test', 'hash');
      expect(bcrypt.compare).toHaveBeenCalledWith('test', 'hash');
      expect(result).toBe(true);
    });

    it('returns false on mismatch', async () => {
      bcrypt.compare.mockResolvedValue(false);
      const result = await verifyPassword('wrong', 'hash');
      expect(result).toBe(false);
    });
  });

  describe('login', () => {
    const mockUser = {
      id: 'user-uuid',
      vendor_id: 'vendor-uuid',
      email: 'test@vendor.com',
      name: 'Test User',
      role: 'admin',
      password_hash: '$2b$12$hash',
      is_active: true,
      vendor_name: 'Test Vendor',
      vendor_active: true,
    };

    // The login() function calls cleanupExpiredSessions() fire-and-forget BEFORE
    // the user lookup query. This consumes the first db.query mock value.
    // So we must prepend a mock for the cleanup DELETE query.

    it('authenticates valid credentials and creates session', async () => {
      db.query
        .mockResolvedValueOnce({ rowCount: 0 })              // cleanup expired sessions
        .mockResolvedValueOnce({ rows: [mockUser] })          // lookup user
        .mockResolvedValueOnce({ rows: [] })                  // insert session
        .mockResolvedValueOnce({ rows: [] });                 // update last_login
      bcrypt.compare.mockResolvedValue(true);

      const result = await login('test@vendor.com', 'password123', { ip: '127.0.0.1' });

      expect(result.sessionId).toBeTruthy();
      expect(result.sessionId.length).toBe(64); // 32 bytes hex
      expect(result.user.email).toBe('test@vendor.com');
      expect(result.user.vendorId).toBe('vendor-uuid');
      expect(result.user.role).toBe('admin');
    });

    it('throws on invalid email', async () => {
      db.query
        .mockResolvedValueOnce({ rowCount: 0 })    // cleanup
        .mockResolvedValueOnce({ rows: [] });       // user lookup (no match)

      await expect(login('nobody@test.com', 'pass')).rejects.toThrow('Invalid email or password');
    });

    it('throws on wrong password', async () => {
      db.query
        .mockResolvedValueOnce({ rowCount: 0 })            // cleanup
        .mockResolvedValueOnce({ rows: [mockUser] });       // user lookup
      bcrypt.compare.mockResolvedValue(false);

      await expect(login('test@vendor.com', 'wrong')).rejects.toThrow('Invalid email or password');
    });

    it('throws on inactive user', async () => {
      db.query
        .mockResolvedValueOnce({ rowCount: 0 })                                 // cleanup
        .mockResolvedValueOnce({ rows: [{ ...mockUser, is_active: false }] });   // user lookup

      await expect(login('test@vendor.com', 'pass')).rejects.toThrow('Account is disabled');
    });

    it('throws on inactive vendor', async () => {
      db.query
        .mockResolvedValueOnce({ rowCount: 0 })                                     // cleanup
        .mockResolvedValueOnce({ rows: [{ ...mockUser, vendor_active: false }] });   // user lookup

      await expect(login('test@vendor.com', 'pass')).rejects.toThrow('Vendor account is disabled');
    });
  });

  describe('validateSession', () => {
    it('returns user on valid session', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      db.query.mockResolvedValueOnce({
        rows: [{
          session_id: 'sess1',
          expires_at: futureDate,
          user_id: 'u1',
          vendor_id: 'v1',
          email: 'test@v.com',
          name: 'Test',
          role: 'admin',
          user_active: true,
          vendor_name: 'Vendor',
          vendor_active: true,
        }],
      });

      const user = await validateSession('sess1');
      expect(user.id).toBe('u1');
      expect(user.vendorId).toBe('v1');
      expect(user.role).toBe('admin');
    });

    it('throws on null session ID', async () => {
      await expect(validateSession(null)).rejects.toThrow('Session required');
    });

    it('throws on non-existent session', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      await expect(validateSession('nonexistent')).rejects.toThrow('Invalid or expired session');
    });

    it('throws and cleans up expired session', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      db.query
        .mockResolvedValueOnce({
          rows: [{
            session_id: 'expired',
            expires_at: pastDate,
            user_id: 'u1',
            vendor_id: 'v1',
            email: 'x',
            name: 'x',
            role: 'admin',
            user_active: true,
            vendor_name: 'V',
            vendor_active: true,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }); // DELETE

      await expect(validateSession('expired')).rejects.toThrow('Session expired');
      expect(db.query).toHaveBeenCalledWith('DELETE FROM portal_sessions WHERE id = $1', ['expired']);
    });
  });

  describe('logout', () => {
    it('deletes the session row', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      await logout('sess1');
      expect(db.query).toHaveBeenCalledWith('DELETE FROM portal_sessions WHERE id = $1', ['sess1']);
    });

    it('does nothing with null session ID', async () => {
      await logout(null);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('deletes expired sessions', async () => {
      db.query.mockResolvedValueOnce({ rowCount: 3 });
      await cleanupExpiredSessions();
      expect(db.query).toHaveBeenCalledWith('DELETE FROM portal_sessions WHERE expires_at < NOW()');
    });
  });
});
