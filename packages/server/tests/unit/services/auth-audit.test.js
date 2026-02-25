import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../../../src/db/index.js', () => ({
  query: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/utils/metrics.js', () => ({
  authFailuresTotal: { inc: vi.fn() },
}));

import * as db from '../../../src/db/index.js';
import logger from '../../../src/utils/logger.js';
import { authFailuresTotal } from '../../../src/utils/metrics.js';
import { logFailure, getRecentFailures, maskIdentifier } from '../../../src/services/auth-audit.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auth-audit service', () => {
  describe('maskIdentifier()', () => {
    it('masks API keys: cb_sk_ prefix', () => {
      expect(maskIdentifier('cb_sk_1234abcdef', 'api_key')).toBe('cb_sk_12****');
    });

    it('masks API keys: cb_pk_ prefix', () => {
      expect(maskIdentifier('cb_pk_9876xyz', 'api_key')).toBe('cb_pk_98****');
    });

    it('masks API keys without known prefix', () => {
      expect(maskIdentifier('unknownkey123', 'api_key')).toBe('un****');
    });

    it('masks emails', () => {
      expect(maskIdentifier('admin@foo.com', 'email')).toBe('ad***@foo.com');
    });

    it('masks short emails', () => {
      expect(maskIdentifier('a@b.com', 'email')).toBe('a***@b.com');
    });

    it('handles email with no @ gracefully', () => {
      expect(maskIdentifier('notanemail', 'email')).toBe('****');
    });

    it('returns null for null input', () => {
      expect(maskIdentifier(null, 'api_key')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(maskIdentifier('', 'api_key')).toBeNull();
    });
  });

  describe('logFailure()', () => {
    it('writes to DB with masked identifier', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await logFailure({
        tenantId: 'tenant-uuid',
        authType: 'api_key',
        identifier: 'cb_sk_1234abcdef',
        ip: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        reason: 'invalid_key',
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO auth_failures'),
        ['tenant-uuid', 'api_key', 'cb_sk_12****', '127.0.0.1', 'Mozilla/5.0', 'invalid_key']
      );
    });

    it('increments Prometheus counter', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await logFailure({
        tenantId: null,
        authType: 'portal_login',
        identifier: 'admin@foo.com',
        ip: '10.0.0.1',
        reason: 'bad_password',
      });

      expect(authFailuresTotal.inc).toHaveBeenCalledWith({
        auth_type: 'portal_login',
        reason: 'bad_password',
      });
    });

    it('masks email identifiers for portal_login type', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await logFailure({
        tenantId: null,
        authType: 'portal_login',
        identifier: 'admin@foo.com',
        ip: '10.0.0.1',
        reason: 'bad_password',
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['ad***@foo.com'])
      );
    });

    it('does not throw on DB error (non-fatal)', async () => {
      db.query.mockRejectedValueOnce(new Error('DB down'));

      // Should not throw
      await logFailure({
        tenantId: null,
        authType: 'api_key',
        identifier: 'cb_sk_badkey',
        ip: '127.0.0.1',
        reason: 'invalid_key',
      });

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'auth audit log write failed'
      );
    });

    it('handles null tenantId', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await logFailure({
        tenantId: null,
        authType: 'api_key',
        identifier: 'cb_sk_abc',
        ip: '127.0.0.1',
        reason: 'invalid_key',
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([null])
      );
    });

    it('truncates long user agent strings', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      const longUA = 'A'.repeat(600);

      await logFailure({
        tenantId: null,
        authType: 'api_key',
        identifier: 'cb_sk_xyz',
        ip: '10.0.0.1',
        userAgent: longUA,
        reason: 'invalid_key',
      });

      const args = db.query.mock.calls[0][1];
      expect(args[4].length).toBe(512); // truncated
    });
  });

  describe('getRecentFailures()', () => {
    it('queries by tenant ID with limit', async () => {
      const mockRows = [
        { id: 1, auth_type: 'api_key', identifier: 'cb_sk_12****', reason: 'invalid_key', created_at: new Date() },
      ];
      db.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await getRecentFailures('tenant-uuid', 25);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE tenant_id = $1'),
        ['tenant-uuid', 25]
      );
      expect(result).toEqual(mockRows);
    });

    it('uses default limit of 50', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      await getRecentFailures('tenant-uuid');

      const args = db.query.mock.calls[0][1];
      expect(args[1]).toBe(50);
    });
  });
});
