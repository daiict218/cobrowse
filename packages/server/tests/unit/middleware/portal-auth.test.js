import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/vendor-auth.js', () => ({
  validateSession: vi.fn(),
}));

import { validateSession } from '../../../src/services/vendor-auth.js';
import { authenticatePortal, requireAdmin, extractSessionCookie } from '../../../src/middleware/portal-auth.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('portal-auth middleware', () => {
  describe('extractSessionCookie', () => {
    it('extracts cookie from header', () => {
      const request = { headers: { cookie: 'cb_portal_session=abc123; other=val' } };
      expect(extractSessionCookie(request)).toBe('abc123');
    });

    it('returns null without cookie header', () => {
      const request = { headers: {} };
      expect(extractSessionCookie(request)).toBeNull();
    });

    it('returns null when cookie not present', () => {
      const request = { headers: { cookie: 'other=val' } };
      expect(extractSessionCookie(request)).toBeNull();
    });

    it('handles cookie as first value', () => {
      const request = { headers: { cookie: 'cb_portal_session=xyz' } };
      expect(extractSessionCookie(request)).toBe('xyz');
    });
  });

  describe('authenticatePortal', () => {
    it('sets portalUser on valid session', async () => {
      const user = { id: 'u1', role: 'admin', vendorId: 'v1' };
      validateSession.mockResolvedValue(user);

      const request = { headers: { cookie: 'cb_portal_session=sess1' } };
      const reply = {};

      await authenticatePortal(request, reply);
      expect(request.portalUser).toEqual(user);
      expect(validateSession).toHaveBeenCalledWith('sess1');
    });

    it('throws when no cookie', async () => {
      validateSession.mockRejectedValue(new Error('Session required'));
      const request = { headers: {} };
      await expect(authenticatePortal(request, {})).rejects.toThrow();
    });
  });

  describe('requireAdmin', () => {
    it('passes for admin role', async () => {
      validateSession.mockResolvedValue({ id: 'u1', role: 'admin', vendorId: 'v1' });
      const request = { headers: { cookie: 'cb_portal_session=sess1' } };
      await requireAdmin(request, {});
      expect(request.portalUser.role).toBe('admin');
    });

    it('throws for viewer role', async () => {
      validateSession.mockResolvedValue({ id: 'u1', role: 'viewer', vendorId: 'v1' });
      const request = { headers: { cookie: 'cb_portal_session=sess1' } };
      await expect(requireAdmin(request, {})).rejects.toThrow('Admin access required');
    });
  });
});
