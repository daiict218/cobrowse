import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/db/index.js', () => ({
  query: vi.fn(),
}));

vi.mock('../../../src/utils/token.js', () => ({
  generateSecretKey: vi.fn().mockReturnValue('cb_sk_testsecret'),
  generatePublicKey: vi.fn().mockReturnValue('cb_pk_testpublic'),
  hashApiKey: vi.fn().mockReturnValue('hashedkey'),
}));

import * as db from '../../../src/db/index.js';
import {
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  rotateKeys,
  getMaskingRules,
  updateMaskingRules,
  listSessions,
  getTenantAnalytics,
  getVendorOverview,
} from '../../../src/services/vendor.js';

beforeEach(() => {
  vi.clearAllMocks();
});

const vendorId = 'vendor-uuid';
const tenantId = 'tenant-uuid';

const mockTenant = {
  id: tenantId,
  name: 'Test Tenant',
  allowed_domains: ['example.com'],
  masking_rules: { selectors: [], maskTypes: ['password'], patterns: [] },
  feature_flags: { agentControl: false },
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('vendor service', () => {
  describe('listTenants', () => {
    it('returns tenants for vendor', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] });
      const tenants = await listTenants(vendorId);
      expect(tenants).toHaveLength(1);
      expect(tenants[0].name).toBe('Test Tenant');
      expect(db.query.mock.calls[0][1]).toEqual([vendorId]);
    });
  });

  describe('getTenant', () => {
    it('returns tenant owned by vendor', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] });
      const tenant = await getTenant(vendorId, tenantId);
      expect(tenant.name).toBe('Test Tenant');
    });

    it('throws NotFoundError for wrong vendor', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      await expect(getTenant('other-vendor', tenantId)).rejects.toThrow('Tenant not found');
    });
  });

  describe('createTenant', () => {
    it('creates tenant and returns keys', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 'new-id', name: 'New Tenant', allowed_domains: [], is_active: true, feature_flags: {}, created_at: new Date() }],
      });

      const result = await createTenant(vendorId, { name: 'New Tenant' });
      expect(result.tenant.name).toBe('New Tenant');
      expect(result.keys.secretKey).toBe('cb_sk_testsecret');
      expect(result.keys.publicKey).toBe('cb_pk_testpublic');
    });

    it('throws on empty name', async () => {
      await expect(createTenant(vendorId, { name: '' })).rejects.toThrow('Tenant name is required');
    });
  });

  describe('updateTenant', () => {
    it('updates tenant properties', async () => {
      // getTenant call
      db.query.mockResolvedValueOnce({ rows: [mockTenant] });
      // UPDATE call
      db.query.mockResolvedValueOnce({ rows: [{ ...mockTenant, name: 'Updated' }] });

      const result = await updateTenant(vendorId, tenantId, { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('throws on no fields', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] });
      await expect(updateTenant(vendorId, tenantId, {})).rejects.toThrow('No valid fields');
    });
  });

  describe('rotateKeys', () => {
    it('generates new keys', async () => {
      // getTenant
      db.query.mockResolvedValueOnce({ rows: [mockTenant] });
      // UPDATE
      db.query.mockResolvedValueOnce({ rows: [] });

      const keys = await rotateKeys(vendorId, tenantId);
      expect(keys.secretKey).toBe('cb_sk_testsecret');
      expect(keys.publicKey).toBe('cb_pk_testpublic');
    });
  });

  describe('getMaskingRules', () => {
    it('returns masking rules', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] });
      const rules = await getMaskingRules(vendorId, tenantId);
      expect(rules.maskTypes).toContain('password');
    });
  });

  describe('updateMaskingRules', () => {
    it('validates regex patterns', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] });
      await expect(
        updateMaskingRules(vendorId, tenantId, {
          selectors: [],
          maskTypes: [],
          patterns: ['[invalid'],
        })
      ).rejects.toThrow('Invalid regex pattern');
    });

    it('saves valid rules', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] });
      db.query.mockResolvedValueOnce({
        rows: [{ masking_rules: { selectors: ['#ssn'], maskTypes: [], patterns: [] } }],
      });
      const rules = await updateMaskingRules(vendorId, tenantId, {
        selectors: ['#ssn'],
        maskTypes: [],
        patterns: [],
      });
      expect(rules.selectors).toContain('#ssn');
    });
  });

  describe('listSessions', () => {
    it('returns paginated sessions', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] }); // getTenant
      db.query.mockResolvedValueOnce({ rows: [{ count: '5' }] }); // count
      db.query.mockResolvedValueOnce({ rows: [{ id: 's1' }, { id: 's2' }] }); // data

      const result = await listSessions(vendorId, tenantId, { page: 1, limit: 2 });
      expect(result.sessions).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.page).toBe(1);
    });
  });

  describe('getTenantAnalytics', () => {
    it('returns aggregated stats', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] }); // getTenant
      db.query.mockResolvedValueOnce({
        rows: [{
          total_sessions: '10',
          consented_sessions: '8',
          idle_timeouts: '1',
          avg_duration_seconds: '120.5',
        }],
      });
      db.query.mockResolvedValueOnce({
        rows: [{ day: '2025-01-01', count: '3' }],
      });

      const result = await getTenantAnalytics(vendorId, tenantId);
      expect(result.totalSessions).toBe(10);
      expect(result.consentRate).toBe(80);
      expect(result.daily).toHaveLength(1);
    });
  });

  describe('getVendorOverview', () => {
    it('returns cross-tenant summary', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 't1', name: 'T1', is_active: true, sessions_24h: '2', sessions_7d: '10', sessions_total: '50' }],
      });
      db.query.mockResolvedValueOnce({
        rows: [{
          total_sessions: '50',
          sessions_24h: '2',
          sessions_7d: '10',
          active_now: '1',
          tenant_count: '1',
        }],
      });

      const result = await getVendorOverview(vendorId);
      expect(result.tenantCount).toBe(1);
      expect(result.sessions7d).toBe(10);
      expect(result.tenants).toHaveLength(1);
    });
  });
});
