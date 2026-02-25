import { TooManyRequestsError } from './errors.js';

/**
 * In-memory sliding window rate limiter for auth failures.
 *
 * After MAX_FAILURES failed auth attempts within WINDOW_MS from the same IP,
 * all subsequent auth attempts are rejected with 429 until the window expires
 * or a successful auth resets the counter.
 *
 * This is intentionally separate from the global HTTP rate limiter (which is
 * per-IP, all routes). This one targets auth-specific abuse: credential stuffing,
 * key guessing, brute-force login.
 *
 * Activation: call start() at server startup. In test environments, start() is
 * not called (the server.js lifecycle doesn't run), so the limiter is inactive.
 * Unit tests exercise the functions directly after calling start().
 */

const MAX_FAILURES = 10;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Map<ip, { count: number, windowStart: number }>
const store = new Map();

let cleanupTimer = null;
let enabled = false;

/**
 * Remove stale entries to prevent memory leaks.
 */
function cleanup() {
  const now = Date.now();
  for (const [ip, entry] of store) {
    if (now - entry.windowStart > WINDOW_MS) {
      store.delete(ip);
    }
  }
}

/**
 * Start the rate limiter and periodic cleanup timer.
 * Must be called explicitly (in server.js). Without calling start(),
 * check/recordFailure/recordSuccess are no-ops.
 */
function start() {
  enabled = true;
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref(); // don't block process exit
}

/**
 * Stop the cleanup timer and clear all state (for graceful shutdown / tests).
 */
function shutdown() {
  enabled = false;
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  store.clear();
}

/**
 * Check if an IP is rate-limited. Throws 429 if over threshold.
 * Call this at the top of auth handlers before any DB lookup.
 */
function check(ip) {
  if (!enabled || !ip) return;
  const entry = store.get(ip);
  if (!entry) return;

  const now = Date.now();
  // Window expired — clear entry
  if (now - entry.windowStart > WINDOW_MS) {
    store.delete(ip);
    return;
  }

  if (entry.count >= MAX_FAILURES) {
    throw new TooManyRequestsError();
  }
}

/**
 * Record a failed auth attempt from an IP.
 */
function recordFailure(ip) {
  if (!enabled || !ip) return;
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // Start a new window
    store.set(ip, { count: 1, windowStart: now });
  } else {
    entry.count++;
  }
}

/**
 * Record a successful auth — resets the failure counter for that IP.
 */
function recordSuccess(ip) {
  if (!enabled || !ip) return;
  store.delete(ip);
}

export {
  check,
  recordFailure,
  recordSuccess,
  start,
  shutdown,
  // Exposed for testing
  MAX_FAILURES,
  WINDOW_MS,
};
