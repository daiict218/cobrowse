import config from '../config.js';
import cache from '../cache/index.js';
import logger from '../utils/logger.js';

/**
 * Distributed session timers — dual-backend abstraction.
 *
 * CACHE_DRIVER=memory  → InProcessBackend (setTimeout, same as before)
 * CACHE_DRIVER=redis   → BullMQBackend (delayed jobs, survives restarts)
 *
 * Hot-path optimisation: touchSession() (called ~12x/sec per active session)
 * does NOT cancel/reschedule BullMQ jobs. Instead it writes a last-activity
 * timestamp to Redis. When the idle job fires, it reads the timestamp and
 * reschedules if activity happened recently.
 *
 * Callback injection via init() avoids circular dependency with session.js.
 */

// ─── Callbacks (injected via init()) ──────────────────────────────────────────

const _noop = async () => {};

let _endSession = _noop;
let _publishIdleWarning = _noop;
let _logAuditEvent = _noop;

// ─── Backend reference ────────────────────────────────────────────────────────

let _backend;

/**
 * Ensure a backend exists. If init() hasn't been called yet (e.g. in tests),
 * lazily create an InProcess backend so calls don't crash.
 */
function _ensureBackend() {
  if (!_backend) {
    _backend = new InProcessBackend();
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the timer subsystem. Must be called once at startup.
 */
function init({ endSession, publishIdleWarning, logAuditEvent }) {
  _endSession = endSession;
  _publishIdleWarning = publishIdleWarning;
  _logAuditEvent = logAuditEvent;

  if (config.cache.driver === 'redis') {
    _backend = new BullMQBackend();
    logger.info('Session timers: BullMQ (distributed)');
  } else {
    _backend = new InProcessBackend();
    logger.info('Session timers: in-process (use CACHE_DRIVER=redis for distributed)');
  }
}

function scheduleMaxDuration(sessionId, tenantId) {
  _ensureBackend();
  _backend.scheduleMaxDuration(sessionId, tenantId);
}

function resetIdleTimer(sessionId, tenantId) {
  _ensureBackend();
  _backend.resetIdleTimer(sessionId, tenantId);
}

function touchSession(sessionId, tenantId) {
  _ensureBackend();
  _backend.touchSession(sessionId, tenantId);
}

function clearTimers(sessionId) {
  _ensureBackend();
  _backend.clearTimers(sessionId);
}

async function shutdown() {
  if (_backend && typeof _backend.shutdown === 'function') {
    await _backend.shutdown();
  }
}

// ─── InProcessBackend (CACHE_DRIVER=memory) ───────────────────────────────────
// Exact same setTimeout logic that was previously inline in session.js.

class InProcessBackend {
  constructor() {
    this._timers = new Map();
  }

  scheduleMaxDuration(sessionId, tenantId) {
    const ms = config.session.maxDurationMinutes * 60 * 1000;
    const timer = setTimeout(() => {
      _endSession(sessionId, tenantId, 'max_duration').catch((err) =>
        logger.error({ err, sessionId }, 'max duration end failed')
      );
    }, ms);
    timer.unref();
    this._timers.set(`max:${sessionId}`, timer);
  }

  resetIdleTimer(sessionId, tenantId) {
    const existingIdle = this._timers.get(`idle:${sessionId}`);
    if (existingIdle) clearTimeout(existingIdle);

    const existingWarn = this._timers.get(`warn:${sessionId}`);
    if (existingWarn) clearTimeout(existingWarn);

    const warnMs = (config.session.idleTimeoutMinutes * 60 - 60) * 1000; // 1 min warning
    const endMs  = config.session.idleTimeoutMinutes * 60 * 1000;

    // Warn at (timeout - 1 minute)
    const warnTimer = setTimeout(async () => {
      try {
        await _publishIdleWarning(tenantId, sessionId, 60);
        await _logAuditEvent({ sessionId, tenantId, eventType: 'session.idle_warned' });
      } catch (err) {
        logger.error({ err, sessionId }, 'idle warning failed');
      }
    }, warnMs > 0 ? warnMs : 0);
    warnTimer.unref();

    // End at timeout
    const idleTimer = setTimeout(() => {
      _endSession(sessionId, tenantId, 'idle_timeout').catch((err) =>
        logger.error({ err, sessionId }, 'idle timeout end failed')
      );
    }, endMs);
    idleTimer.unref();

    this._timers.set(`idle:${sessionId}`, idleTimer);
    this._timers.set(`warn:${sessionId}`, warnTimer);
  }

  touchSession(sessionId, tenantId) {
    // In-process: just reset the idle timer directly (same as before)
    this.resetIdleTimer(sessionId, tenantId);
  }

  clearTimers(sessionId) {
    for (const key of [`idle:${sessionId}`, `warn:${sessionId}`, `max:${sessionId}`]) {
      const t = this._timers.get(key);
      if (t) { clearTimeout(t); this._timers.delete(key); }
    }
  }

  async shutdown() {
    // Clear all timers
    for (const [, t] of this._timers) {
      clearTimeout(t);
    }
    this._timers.clear();
  }
}

// ─── BullMQBackend (CACHE_DRIVER=redis) ───────────────────────────────────────
// Uses BullMQ delayed jobs. touchSession() writes a cheap Redis key instead of
// re-scheduling jobs — the worker reads last-activity on fire and reschedules.

const LAST_ACTIVITY_KEY = (sessionId) => `last_activity:${sessionId}`;

class BullMQBackend {
  constructor() {
    this._queue = null;
    this._worker = null;
    this._init();
  }

  async _init() {
    try {
      const { Queue, Worker } = await import('bullmq');
      const { default: Redis } = await import('ioredis');

      const connection = new Redis(config.cache.redisUrl, {
        maxRetriesPerRequest: null, // required by BullMQ
      });

      this._queue = new Queue('session-timers', { connection });

      this._worker = new Worker('session-timers', async (job) => {
        await this._processJob(job);
      }, {
        connection: connection.duplicate(),
        concurrency: 10,
      });

      this._worker.on('failed', (job, err) => {
        logger.error({ err, jobId: job?.id, jobName: job?.name }, 'timer job failed');
      });

      logger.info('BullMQ session-timers queue + worker started');
    } catch (err) {
      logger.error({ err }, 'Failed to initialise BullMQ backend');
      throw err;
    }
  }

  async _processJob(job) {
    const { sessionId, tenantId } = job.data;

    switch (job.name) {
      case 'max-duration': {
        logger.info({ sessionId }, 'max-duration timer fired');
        await _endSession(sessionId, tenantId, 'max_duration');
        break;
      }

      case 'idle-warning': {
        // Check last-activity — maybe the session has been active since scheduling
        const lastActivity = await cache.get(LAST_ACTIVITY_KEY(sessionId));
        const warnMs = (config.session.idleTimeoutMinutes * 60 - 60) * 1000;

        if (lastActivity) {
          const elapsed = Date.now() - lastActivity;
          if (elapsed < warnMs) {
            // Session was active recently — reschedule
            const remaining = warnMs - elapsed;
            await this._addJob('idle-warning', sessionId, tenantId, remaining);
            return;
          }
        }

        logger.info({ sessionId }, 'idle-warning timer fired');
        await _publishIdleWarning(tenantId, sessionId, 60);
        await _logAuditEvent({ sessionId, tenantId, eventType: 'session.idle_warned' });
        break;
      }

      case 'idle-timeout': {
        // Lazy evaluation: check if session was touched since job was scheduled
        const lastAct = await cache.get(LAST_ACTIVITY_KEY(sessionId));
        const endMs = config.session.idleTimeoutMinutes * 60 * 1000;

        if (lastAct) {
          const elapsed = Date.now() - lastAct;
          if (elapsed < endMs) {
            // Session was active — reschedule both warning and timeout
            const remaining = endMs - elapsed;
            const warnRemaining = remaining - 60_000;
            if (warnRemaining > 0) {
              await this._addJob('idle-warning', sessionId, tenantId, warnRemaining);
            }
            await this._addJob('idle-timeout', sessionId, tenantId, remaining);
            return;
          }
        }

        logger.info({ sessionId }, 'idle-timeout timer fired');
        await _endSession(sessionId, tenantId, 'idle_timeout');
        break;
      }

      default:
        logger.warn({ jobName: job.name }, 'unknown timer job name');
    }
  }

  async _addJob(name, sessionId, tenantId, delayMs) {
    if (!this._queue) return;
    const jobId = `${name}_${sessionId}`;
    // Remove existing job if present, then add new one
    try {
      const existing = await this._queue.getJob(jobId);
      if (existing) {
        await existing.remove();
      }
    } catch {
      // Job may not exist — that's fine
    }
    await this._queue.add(name, { sessionId, tenantId }, {
      delay: Math.max(delayMs, 0),
      jobId,
      removeOnComplete: true,
      removeOnFail: 5,
    });
  }

  scheduleMaxDuration(sessionId, tenantId) {
    const ms = config.session.maxDurationMinutes * 60 * 1000;
    this._addJob('max-duration', sessionId, tenantId, ms).catch((err) =>
      logger.error({ err, sessionId }, 'failed to schedule max-duration timer')
    );
  }

  resetIdleTimer(sessionId, tenantId) {
    const warnMs = (config.session.idleTimeoutMinutes * 60 - 60) * 1000;
    const endMs  = config.session.idleTimeoutMinutes * 60 * 1000;

    // Write the current timestamp as last-activity
    cache.set(LAST_ACTIVITY_KEY(sessionId), Date.now(), config.session.idleTimeoutMinutes * 60)
      .catch((err) => logger.error({ err, sessionId }, 'failed to set last_activity'));

    // Schedule both idle warning and idle timeout jobs
    Promise.all([
      this._addJob('idle-warning', sessionId, tenantId, warnMs > 0 ? warnMs : 0),
      this._addJob('idle-timeout', sessionId, tenantId, endMs),
    ]).catch((err) =>
      logger.error({ err, sessionId }, 'failed to schedule idle timers')
    );
  }

  touchSession(sessionId, _tenantId) {
    // Hot path — single cheap Redis SET, no BullMQ operations.
    // The idle-timeout worker reads this when it fires and reschedules if needed.
    cache.set(LAST_ACTIVITY_KEY(sessionId), Date.now(), config.session.idleTimeoutMinutes * 60)
      .catch((err) => logger.error({ err, sessionId }, 'failed to update last_activity'));
  }

  clearTimers(sessionId) {
    if (!this._queue) return;

    const jobIds = [
      `max-duration_${sessionId}`,
      `idle-warning_${sessionId}`,
      `idle-timeout_${sessionId}`,
    ];

    Promise.all(
      jobIds.map(async (jobId) => {
        try {
          const job = await this._queue.getJob(jobId);
          if (job) await job.remove();
        } catch {
          // Job may already be processed or removed
        }
      })
    ).catch((err) =>
      logger.error({ err, sessionId }, 'failed to clear timer jobs')
    );

    // Clean up last-activity key
    cache.del(LAST_ACTIVITY_KEY(sessionId))
      .catch((err) => logger.error({ err, sessionId }, 'failed to delete last_activity'));
  }

  async shutdown() {
    if (this._worker) {
      await this._worker.close();
      logger.info('BullMQ worker closed');
    }
    if (this._queue) {
      await this._queue.close();
      logger.info('BullMQ queue closed');
    }
  }
}

export { init, scheduleMaxDuration, resetIdleTimer, touchSession, clearTimers, shutdown };
