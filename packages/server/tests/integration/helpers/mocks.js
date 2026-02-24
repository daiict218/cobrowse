/**
 * Shared mocks for integration tests.
 */
import { vi } from 'vitest';

/**
 * Create a mock Ably Rest instance.
 */
function createMockAblyRest() {
  const publishFn = vi.fn().mockResolvedValue(undefined);
  return {
    auth: {
      createTokenRequest: vi.fn().mockResolvedValue({
        keyName: 'testapp.testkey',
        timestamp: Date.now(),
        nonce: 'test-nonce',
        capability: '{"*":["*"]}',
        mac: 'testmac',
      }),
    },
    channels: {
      get: vi.fn().mockReturnValue({
        publish: publishFn,
      }),
    },
    _publishFn: publishFn,
  };
}

/**
 * Create a silent logger (suppresses all output in tests).
 */
function createSilentLogger() {
  const noop = () => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    fatal: noop,
    trace: noop,
    child: () => createSilentLogger(),
  };
}

export { createMockAblyRest, createSilentLogger };
