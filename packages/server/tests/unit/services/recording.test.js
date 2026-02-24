import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

// ── Hoisted mock state (shared with vi.mock factories) ──────────────────────

const { mockDb, mockCache, mockStorage } = vi.hoisted(() => ({
  mockDb: { query: vi.fn() },
  mockCache: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  mockStorage: { put: vi.fn(), get: vi.fn(), del: vi.fn(), exists: vi.fn() },
}));

// ── Mocks (must be before import) ───────────────────────────────────────────

vi.mock('../../../src/config.js', () => ({
  default: {
    recording: { driver: 'fs', fsPath: '/tmp/test-recordings' },
    session: { snapshotTtlSeconds: 7200, maxDurationMinutes: 120 },
    cache: { driver: 'memory' },
  },
}));

vi.mock('../../../src/db/index.js', () => mockDb);

vi.mock('../../../src/cache/index.js', () => ({ default: mockCache }));

vi.mock('../../../src/storage/index.js', () => ({ default: mockStorage }));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/utils/metrics.js', () => ({
  recordingEventsTotal: { inc: vi.fn() },
  recordingSizeBytes: { observe: vi.fn() },
}));

// ── Import after mocks ─────────────────────────────────────────────────────

import * as recording from '../../../src/services/recording.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const SESSION_ID = '00000000-0000-0000-0000-000000000002';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('recording.isEnabled', () => {
  it('returns true when sessionReplay flag is true', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ feature_flags: { sessionReplay: true } }],
    });
    expect(await recording.isEnabled(TENANT_ID)).toBe(true);
  });

  it('returns false when sessionReplay flag is false', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ feature_flags: { sessionReplay: false } }],
    });
    expect(await recording.isEnabled(TENANT_ID)).toBe(false);
  });

  it('returns false when tenant not found', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    expect(await recording.isEnabled(TENANT_ID)).toBe(false);
  });
});

describe('recording.startRecording', () => {
  it('creates a DB row when enabled', async () => {
    // isEnabled check
    mockDb.query.mockResolvedValueOnce({
      rows: [{ feature_flags: { sessionReplay: true } }],
    });
    // INSERT
    mockDb.query.mockResolvedValueOnce({
      rows: [{ id: 'rec-1', session_id: SESSION_ID, status: 'recording' }],
    });

    const result = await recording.startRecording(SESSION_ID, TENANT_ID, [{ type: 4 }]);
    expect(result).toBeTruthy();
    expect(result.status).toBe('recording');
    // Initial snapshot should be buffered in cache
    expect(mockCache.set).toHaveBeenCalled();
  });

  it('returns null when feature flag is disabled', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{ feature_flags: { sessionReplay: false } }],
    });
    const result = await recording.startRecording(SESSION_ID, TENANT_ID, []);
    expect(result).toBeNull();
  });
});

describe('recording.bufferEvents', () => {
  it('accumulates events in cache', async () => {
    mockCache.get.mockResolvedValueOnce([{ type: 4, data: {} }]);

    await recording.bufferEvents(SESSION_ID, [{ type: 3, data: {} }]);

    expect(mockCache.set).toHaveBeenCalledWith(
      `rec_buf:${SESSION_ID}`,
      expect.arrayContaining([
        { type: 4, data: {} },
        { type: 3, data: {} },
      ]),
      7200
    );
  });

  it('initialises buffer when cache is empty', async () => {
    mockCache.get.mockResolvedValueOnce(null);

    await recording.bufferEvents(SESSION_ID, [{ type: 3, data: {} }]);

    expect(mockCache.set).toHaveBeenCalledWith(
      `rec_buf:${SESSION_ID}`,
      [{ type: 3, data: {} }],
      7200
    );
  });
});

describe('recording.flushBuffer', () => {
  it('compresses and writes buffered events to storage', async () => {
    const events = [{ type: 4 }, { type: 2 }];
    mockCache.get.mockResolvedValueOnce(events);

    // _flushToStorage looks up the recording row
    mockDb.query.mockResolvedValueOnce({
      rows: [{ storage_key: `${SESSION_ID}.gz`, event_count: 0 }],
    });
    // storage.get returns null (first flush)
    mockStorage.get.mockResolvedValueOnce(null);
    // UPDATE event_count
    mockDb.query.mockResolvedValueOnce({ rowCount: 1 });

    await recording.flushBuffer(SESSION_ID);

    expect(mockStorage.put).toHaveBeenCalledWith(
      `${SESSION_ID}.gz`,
      expect.any(Buffer)
    );
    // Buffer should be cleared after flush
    expect(mockCache.set).toHaveBeenCalledWith(
      `rec_buf:${SESSION_ID}`,
      [],
      7200
    );
  });
});

describe('recording.finalizeRecording', () => {
  it('marks recording as complete', async () => {
    // flushBuffer: cache.get returns empty
    mockCache.get.mockResolvedValueOnce([]);
    // cache.del
    mockCache.del.mockResolvedValueOnce(undefined);
    // Session lookup for duration
    mockDb.query.mockResolvedValueOnce({
      rows: [{ customer_joined_at: '2025-01-01T00:00:00Z', ended_at: '2025-01-01T00:05:00Z' }],
    });
    // UPDATE status = complete
    mockDb.query.mockResolvedValueOnce({ rowCount: 1 });

    await recording.finalizeRecording(SESSION_ID);

    // Should have been called with duration_ms = 300000
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'complete'"),
      expect.arrayContaining([300000, SESSION_ID])
    );
  });
});

describe('recording.getRecordingData', () => {
  it('decompresses and returns events', async () => {
    const events = [{ type: 4 }, { type: 2 }];
    const compressed = await gzipAsync(Buffer.from(JSON.stringify(events)));

    // getRecordingMeta query
    mockDb.query.mockResolvedValueOnce({
      rows: [{ storage_key: `${SESSION_ID}.gz`, status: 'complete' }],
    });
    mockStorage.get.mockResolvedValueOnce(compressed);

    const result = await recording.getRecordingData(SESSION_ID, TENANT_ID);
    expect(result.events).toEqual(events);
    expect(result.meta.status).toBe('complete');
  });

  it('returns null when recording not found', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    const result = await recording.getRecordingData(SESSION_ID, TENANT_ID);
    expect(result).toBeNull();
  });
});
