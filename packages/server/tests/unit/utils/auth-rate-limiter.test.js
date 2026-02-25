import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  check,
  recordFailure,
  recordSuccess,
  start,
  shutdown,
  MAX_FAILURES,
  WINDOW_MS,
} from '../../../src/utils/auth-rate-limiter.js';
import { TooManyRequestsError } from '../../../src/utils/errors.js';

beforeEach(() => {
  shutdown(); // clear all state between tests
  start();    // enable the limiter for direct unit testing
});

afterEach(() => {
  shutdown();
});

describe('auth-rate-limiter', () => {
  describe('check()', () => {
    it('does not throw for unknown IP', () => {
      expect(() => check('1.2.3.4')).not.toThrow();
    });

    it('does not throw for null/undefined IP', () => {
      expect(() => check(null)).not.toThrow();
      expect(() => check(undefined)).not.toThrow();
    });

    it('does not throw under threshold', () => {
      for (let i = 0; i < MAX_FAILURES - 1; i++) {
        recordFailure('10.0.0.1');
      }
      expect(() => check('10.0.0.1')).not.toThrow();
    });

    it('throws TooManyRequestsError at threshold', () => {
      for (let i = 0; i < MAX_FAILURES; i++) {
        recordFailure('10.0.0.2');
      }
      expect(() => check('10.0.0.2')).toThrow(TooManyRequestsError);
    });

    it('throws with correct status code and message', () => {
      for (let i = 0; i < MAX_FAILURES; i++) {
        recordFailure('10.0.0.3');
      }
      try {
        check('10.0.0.3');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err.statusCode).toBe(429);
        expect(err.code).toBe('TOO_MANY_REQUESTS');
      }
    });

    it('does not affect other IPs', () => {
      for (let i = 0; i < MAX_FAILURES; i++) {
        recordFailure('10.0.0.4');
      }
      expect(() => check('10.0.0.5')).not.toThrow();
    });
  });

  describe('recordSuccess()', () => {
    it('resets the counter for the IP', () => {
      for (let i = 0; i < MAX_FAILURES; i++) {
        recordFailure('10.0.0.6');
      }
      expect(() => check('10.0.0.6')).toThrow(TooManyRequestsError);

      recordSuccess('10.0.0.6');
      expect(() => check('10.0.0.6')).not.toThrow();
    });

    it('does not throw for unknown IP', () => {
      expect(() => recordSuccess('unknown-ip')).not.toThrow();
    });

    it('handles null IP gracefully', () => {
      expect(() => recordSuccess(null)).not.toThrow();
    });
  });

  describe('recordFailure()', () => {
    it('handles null IP gracefully', () => {
      expect(() => recordFailure(null)).not.toThrow();
    });

    it('increments count on repeated failures', () => {
      // Record MAX_FAILURES - 1 failures: should still pass
      for (let i = 0; i < MAX_FAILURES - 1; i++) {
        recordFailure('10.0.0.7');
      }
      expect(() => check('10.0.0.7')).not.toThrow();

      // One more failure: should now be blocked
      recordFailure('10.0.0.7');
      expect(() => check('10.0.0.7')).toThrow(TooManyRequestsError);
    });
  });

  describe('window expiry', () => {
    it('resets after window expires', () => {
      vi.useFakeTimers();
      try {
        for (let i = 0; i < MAX_FAILURES; i++) {
          recordFailure('10.0.0.8');
        }
        expect(() => check('10.0.0.8')).toThrow(TooManyRequestsError);

        // Advance time past the window
        vi.advanceTimersByTime(WINDOW_MS + 1);

        // Should no longer be blocked
        expect(() => check('10.0.0.8')).not.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });

    it('starts a new window after expiry', () => {
      vi.useFakeTimers();
      try {
        // Fill up the window
        for (let i = 0; i < MAX_FAILURES; i++) {
          recordFailure('10.0.0.9');
        }
        expect(() => check('10.0.0.9')).toThrow(TooManyRequestsError);

        // Expire the window
        vi.advanceTimersByTime(WINDOW_MS + 1);

        // Record one more failure — starts new window
        recordFailure('10.0.0.9');
        expect(() => check('10.0.0.9')).not.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('start() / shutdown()', () => {
    it('start() is idempotent', () => {
      start();
      start();
      // No error thrown
      shutdown();
    });

    it('shutdown() clears all state', () => {
      for (let i = 0; i < MAX_FAILURES; i++) {
        recordFailure('10.0.0.10');
      }
      expect(() => check('10.0.0.10')).toThrow(TooManyRequestsError);

      shutdown();
      expect(() => check('10.0.0.10')).not.toThrow();
    });
  });
});
