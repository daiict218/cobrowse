import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../../src/db/index.js', () => ({
  query: mockQuery,
  transaction: vi.fn(async (fn) => fn({ query: mockQuery })),
}));

vi.mock('../../../src/utils/token.js', () => ({
  generateSecretKey: vi.fn().mockReturnValue('cb_sk_testsecret'),
  generatePublicKey: vi.fn().mockReturnValue('cb_pk_testpublic'),
  hashApiKey: vi.fn().mockReturnValue('hashedkey'),
}));

const { mockIsEnabled, mockGetRecordingData } = vi.hoisted(() => ({
  mockIsEnabled: vi.fn(),
  mockGetRecordingData: vi.fn(),
}));
vi.mock('../../../src/services/recording.js', () => ({
  isEnabled: mockIsEnabled,
  getRecordingData: mockGetRecordingData,
}));

import * as db from '../../../src/db/index.js';
import { listRecordings, getRecording } from '../../../src/services/vendor.js';

beforeEach(() => {
  vi.clearAllMocks();
});

const vendorId = 'vendor-uuid';
const tenantId = 'tenant-uuid';
const sessionId = 'session-uuid';

const mockTenant = {
  id: tenantId,
  name: 'Test Tenant',
  allowed_domains: ['example.com'],
  masking_rules: { selectors: [], maskTypes: ['password'], patterns: [] },
  feature_flags: { sessionReplay: true },
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockRecording = {
  id: 'rec-1',
  session_id: sessionId,
  status: 'complete',
  event_count: 150,
  duration_ms: 60000,
  compressed_size: 8192,
  raw_size: 45000,
  started_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
  agent_id: 'agent_001',
  customer_id: 'cust_001',
};

describe('vendor recordings', () => {
  describe('listRecordings', () => {
    it('returns paginated recordings', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] }); // getTenant
      db.query.mockResolvedValueOnce({ rows: [{ count: '3' }] }); // COUNT
      db.query.mockResolvedValueOnce({ rows: [mockRecording] }); // SELECT

      const result = await listRecordings(vendorId, tenantId, { page: 1, limit: 20 });
      expect(result.recordings).toHaveLength(1);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('filters by status', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] }); // getTenant
      db.query.mockResolvedValueOnce({ rows: [{ count: '1' }] }); // COUNT
      db.query.mockResolvedValueOnce({ rows: [mockRecording] }); // SELECT

      const result = await listRecordings(vendorId, tenantId, { page: 1, limit: 20, status: 'complete' });
      expect(result.recordings).toHaveLength(1);

      // Verify status filter was included in COUNT query
      const countCall = db.query.mock.calls[1];
      expect(countCall[0]).toContain('sr.status = $2');
      expect(countCall[1]).toContain('complete');
    });

    it('throws NotFoundError for wrong vendor', async () => {
      db.query.mockResolvedValueOnce({ rows: [] }); // getTenant returns nothing
      await expect(listRecordings('other-vendor', tenantId)).rejects.toThrow('Tenant not found');
    });

    it('returns empty results when no recordings exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] }); // getTenant
      db.query.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // COUNT
      db.query.mockResolvedValueOnce({ rows: [] }); // SELECT

      const result = await listRecordings(vendorId, tenantId);
      expect(result.recordings).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('uses default page and limit', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] });
      db.query.mockResolvedValueOnce({ rows: [{ count: '0' }] });
      db.query.mockResolvedValueOnce({ rows: [] });

      const result = await listRecordings(vendorId, tenantId);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  describe('getRecording', () => {
    it('returns recording data for valid session', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] }); // getTenant
      mockGetRecordingData.mockResolvedValueOnce({
        meta: { session_id: sessionId, event_count: 150, duration_ms: 60000 },
        events: [{ type: 2, timestamp: 1000 }],
      });

      const result = await getRecording(vendorId, tenantId, sessionId);
      expect(result.meta.session_id).toBe(sessionId);
      expect(result.events).toHaveLength(1);
      expect(mockGetRecordingData).toHaveBeenCalledWith(sessionId, tenantId);
    });

    it('throws NotFoundError when recording does not exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockTenant] }); // getTenant
      mockGetRecordingData.mockResolvedValueOnce(null);

      await expect(getRecording(vendorId, tenantId, sessionId)).rejects.toThrow('Recording not found');
    });

    it('throws NotFoundError for wrong vendor', async () => {
      db.query.mockResolvedValueOnce({ rows: [] }); // getTenant returns nothing
      await expect(getRecording('other-vendor', tenantId, sessionId)).rejects.toThrow('Tenant not found');
    });
  });
});
