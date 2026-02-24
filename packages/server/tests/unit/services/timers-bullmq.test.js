import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Computed values from config ─────────────────────────────────────────────
const MAX_DURATION_MIN = 5;
const IDLE_TIMEOUT_MIN = 2;
const MAX_MS  = MAX_DURATION_MIN * 60 * 1000;   // 300_000
const IDLE_MS = IDLE_TIMEOUT_MIN * 60 * 1000;   // 120_000
const WARN_MS = (IDLE_TIMEOUT_MIN * 60 - 60) * 1000; // 60_000

// ── Hoisted mock state (available inside vi.mock factories) ─────────────────

const { state, mockJobs } = vi.hoisted(() => {
  const mockJobs = new Map();
  return {
    state: {
      capturedProcessor: null,
      mockQueue: null,
      mockWorker: null,
    },
    mockJobs,
  };
});

function resetMockQueue() {
  mockJobs.clear();
  state.mockQueue = {
    add: vi.fn(async (name, data, opts) => {
      const job = { id: opts.jobId, name, data, opts, remove: vi.fn() };
      mockJobs.set(opts.jobId, job);
      return job;
    }),
    getJob: vi.fn(async (jobId) => mockJobs.get(jobId) || null),
    close: vi.fn().mockResolvedValue(undefined),
  };
  state.mockWorker = {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Mocks (must be before import) ───────────────────────────────────────────

vi.mock('../../../src/config.js', () => ({
  default: {
    cache: { driver: 'redis', redisUrl: 'redis://localhost:6379' },
    session: {
      maxDurationMinutes: 5,
      idleTimeoutMinutes: 2,
    },
  },
}));

vi.mock('../../../src/cache/index.js', () => ({
  default: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('ioredis', () => {
  const inst = { on: vi.fn().mockReturnThis(), duplicate: vi.fn() };
  inst.duplicate.mockReturnValue(inst);
  return {
    default: vi.fn(function MockRedis() { return inst; }),
  };
});

vi.mock('bullmq', () => ({
  Queue: vi.fn(function MockQueue() { return state.mockQueue; }),
  Worker: vi.fn(function MockWorker(_name, processor) {
    state.capturedProcessor = processor;
    return state.mockWorker;
  }),
}));

// ── Imports (after mocks) ───────────────────────────────────────────────────

import * as timers from '../../../src/services/timers.js';
import cache from '../../../src/cache/index.js';
import { Queue, Worker } from 'bullmq';

// ── Helpers ─────────────────────────────────────────────────────────────────

let endSession;
let publishIdleWarning;
let logAuditEvent;

async function initAndWait() {
  timers.init({ endSession, publishIdleWarning, logAuditEvent });
  // The BullMQ backend's _init() is async — wait one tick for it to complete
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  resetMockQueue();
  state.capturedProcessor = null;
  endSession         = vi.fn().mockResolvedValue(undefined);
  publishIdleWarning = vi.fn().mockResolvedValue(undefined);
  logAuditEvent      = vi.fn().mockResolvedValue(undefined);

  await initAndWait();
});

afterEach(async () => {
  await timers.shutdown();
  vi.clearAllMocks();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe('init', () => {
  it('creates BullMQ Queue and Worker with session-timers name', () => {
    expect(Queue).toHaveBeenCalledWith('session-timers', expect.any(Object));
    expect(Worker).toHaveBeenCalledWith('session-timers', expect.any(Function), expect.any(Object));
  });

  it('passes redisUrl to ioredis with maxRetriesPerRequest: null', async () => {
    const Redis = (await import('ioredis')).default;
    expect(Redis).toHaveBeenCalledWith('redis://localhost:6379', { maxRetriesPerRequest: null });
  });
});

describe('scheduleMaxDuration', () => {
  it('adds a max-duration job with correct delay and deterministic jobId', async () => {
    timers.scheduleMaxDuration('s1', 't1');
    await new Promise((r) => setTimeout(r, 0));

    expect(state.mockQueue.add).toHaveBeenCalledWith(
      'max-duration',
      { sessionId: 's1', tenantId: 't1' },
      expect.objectContaining({
        delay: MAX_MS,
        jobId: 'max-duration_s1',
        removeOnComplete: true,
      })
    );
  });

  it('removes existing job before adding new one', async () => {
    timers.scheduleMaxDuration('s1', 't1');
    await new Promise((r) => setTimeout(r, 0));

    const firstJob = mockJobs.get('max-duration_s1');
    expect(firstJob).toBeDefined();

    // Schedule again — _addJob should call getJob then remove
    timers.scheduleMaxDuration('s1', 't1');
    await new Promise((r) => setTimeout(r, 0));

    expect(state.mockQueue.getJob).toHaveBeenCalledWith('max-duration_s1');
    expect(firstJob.remove).toHaveBeenCalled();
  });
});

describe('resetIdleTimer', () => {
  it('writes last_activity timestamp to cache', async () => {
    timers.resetIdleTimer('s1', 't1');
    await new Promise((r) => setTimeout(r, 0));

    expect(cache.set).toHaveBeenCalledWith(
      'last_activity:s1',
      expect.any(Number),
      IDLE_TIMEOUT_MIN * 60
    );
  });

  it('adds idle-warning and idle-timeout jobs', async () => {
    timers.resetIdleTimer('s1', 't1');
    await new Promise((r) => setTimeout(r, 0));

    expect(state.mockQueue.add).toHaveBeenCalledWith(
      'idle-warning',
      { sessionId: 's1', tenantId: 't1' },
      expect.objectContaining({ delay: WARN_MS, jobId: 'idle-warning_s1' })
    );
    expect(state.mockQueue.add).toHaveBeenCalledWith(
      'idle-timeout',
      { sessionId: 's1', tenantId: 't1' },
      expect.objectContaining({ delay: IDLE_MS, jobId: 'idle-timeout_s1' })
    );
  });
});

describe('touchSession — hot path optimization', () => {
  it('only writes last_activity to cache (single SET)', async () => {
    cache.set.mockClear();
    state.mockQueue.add.mockClear();

    timers.touchSession('s1', 't1');
    await new Promise((r) => setTimeout(r, 0));

    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledWith(
      'last_activity:s1',
      expect.any(Number),
      IDLE_TIMEOUT_MIN * 60
    );
  });

  it('does NOT add any queue jobs', async () => {
    state.mockQueue.add.mockClear();

    timers.touchSession('s1', 't1');
    await new Promise((r) => setTimeout(r, 0));

    expect(state.mockQueue.add).not.toHaveBeenCalled();
  });
});

describe('clearTimers', () => {
  it('removes all three job types from queue', async () => {
    timers.scheduleMaxDuration('s1', 't1');
    timers.resetIdleTimer('s1', 't1');
    await new Promise((r) => setTimeout(r, 0));

    state.mockQueue.getJob.mockClear();

    timers.clearTimers('s1');
    await new Promise((r) => setTimeout(r, 0));

    expect(state.mockQueue.getJob).toHaveBeenCalledWith('max-duration_s1');
    expect(state.mockQueue.getJob).toHaveBeenCalledWith('idle-warning_s1');
    expect(state.mockQueue.getJob).toHaveBeenCalledWith('idle-timeout_s1');
  });

  it('deletes last_activity cache key', async () => {
    timers.clearTimers('s1');
    await new Promise((r) => setTimeout(r, 0));

    expect(cache.del).toHaveBeenCalledWith('last_activity:s1');
  });
});

describe('worker — _processJob', () => {
  it('max-duration job calls endSession', async () => {
    expect(state.capturedProcessor).toBeTypeOf('function');

    await state.capturedProcessor({ name: 'max-duration', data: { sessionId: 's1', tenantId: 't1' } });
    expect(endSession).toHaveBeenCalledWith('s1', 't1', 'max_duration');
  });

  it('idle-warning reschedules if session was recently active', async () => {
    cache.get.mockResolvedValueOnce(Date.now() - 10_000);
    state.mockQueue.add.mockClear();

    await state.capturedProcessor({ name: 'idle-warning', data: { sessionId: 's1', tenantId: 't1' } });

    expect(publishIdleWarning).not.toHaveBeenCalled();
    expect(state.mockQueue.add).toHaveBeenCalledWith(
      'idle-warning',
      { sessionId: 's1', tenantId: 't1' },
      expect.objectContaining({ jobId: 'idle-warning_s1' })
    );
  });

  it('idle-warning fires warning if session was truly idle', async () => {
    cache.get.mockResolvedValueOnce(Date.now() - WARN_MS - 1000);

    await state.capturedProcessor({ name: 'idle-warning', data: { sessionId: 's1', tenantId: 't1' } });

    expect(publishIdleWarning).toHaveBeenCalledWith('t1', 's1', 60);
    expect(logAuditEvent).toHaveBeenCalledWith({
      sessionId: 's1',
      tenantId: 't1',
      eventType: 'session.idle_warned',
    });
  });

  it('idle-timeout reschedules if session was recently active', async () => {
    cache.get.mockResolvedValueOnce(Date.now() - 30_000);
    state.mockQueue.add.mockClear();

    await state.capturedProcessor({ name: 'idle-timeout', data: { sessionId: 's1', tenantId: 't1' } });

    expect(endSession).not.toHaveBeenCalled();
    expect(state.mockQueue.add).toHaveBeenCalledWith(
      'idle-timeout',
      { sessionId: 's1', tenantId: 't1' },
      expect.objectContaining({ jobId: 'idle-timeout_s1' })
    );
  });

  it('idle-timeout ends session if session was truly idle', async () => {
    cache.get.mockResolvedValueOnce(Date.now() - IDLE_MS - 1000);

    await state.capturedProcessor({ name: 'idle-timeout', data: { sessionId: 's1', tenantId: 't1' } });

    expect(endSession).toHaveBeenCalledWith('s1', 't1', 'idle_timeout');
  });
});

describe('shutdown', () => {
  it('closes worker and queue', async () => {
    await timers.shutdown();

    expect(state.mockWorker.close).toHaveBeenCalled();
    expect(state.mockQueue.close).toHaveBeenCalled();
  });
});
