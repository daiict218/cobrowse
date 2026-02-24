/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Capture } from '../../src/capture.js';

describe('Capture', () => {
  let mockRrweb;
  let stopFn;

  beforeEach(() => {
    stopFn = vi.fn();
    mockRrweb = {
      record: vi.fn((config) => {
        // Simulate rrweb emitting meta + full snapshot synchronously
        if (config.emit) {
          config.emit({ type: 4, data: { href: 'http://localhost', width: 1920, height: 1080 } });
          config.emit({ type: 2, data: { node: { type: 0, childNodes: [] } } });
        }
        return stopFn;
      }),
    };
    window.rrweb = mockRrweb;
  });

  afterEach(() => {
    delete window.rrweb;
  });

  it('calls rrweb.record on start', () => {
    const capture = new Capture({ maskingRules: {}, onEvent: vi.fn(), onUrlChange: vi.fn() });
    capture.start();
    expect(mockRrweb.record).toHaveBeenCalledOnce();
  });

  it('emits events via onEvent callback', () => {
    const onEvent = vi.fn();
    const capture = new Capture({ maskingRules: {}, onEvent, onUrlChange: vi.fn() });
    capture.start();
    // rrweb emits meta (type 4) and full snapshot (type 2)
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[0][0].type).toBe(4);
    expect(onEvent.mock.calls[1][0].type).toBe(2);
  });

  it('passes maskInputFn that applies mask rules', () => {
    const capture = new Capture({
      maskingRules: { selectors: ['input[name="ssn"]'] },
      onEvent: vi.fn(),
      onUrlChange: vi.fn(),
    });
    capture.start();

    const config = mockRrweb.record.mock.calls[0][0];
    expect(config.maskInputFn).toBeDefined();

    // Mock an element that matches the mask selector
    const matchingEl = { matches: vi.fn(() => true) };
    expect(config.maskInputFn('sensitive', matchingEl)).toBe('████');

    // Non-matching element
    const nonMatchingEl = { matches: vi.fn(() => false) };
    expect(config.maskInputFn('normal', nonMatchingEl)).toBe('normal');
  });

  it('sanitises events (removes card numbers)', () => {
    const onEvent = vi.fn();
    // Override rrweb to emit an event with a card number
    mockRrweb.record = vi.fn((config) => {
      config.emit({ type: 3, data: { text: 'card: 4111 1111 1111 1111' } });
      return stopFn;
    });

    const capture = new Capture({ maskingRules: {}, onEvent, onUrlChange: vi.fn() });
    capture.start();

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0][0].data.text).not.toContain('4111');
  });

  it('triggerCheckpoint calls rrweb.record.takeFullSnapshot when available', () => {
    const takeFullSnapshot = vi.fn();
    mockRrweb.record.takeFullSnapshot = takeFullSnapshot;

    const capture = new Capture({ maskingRules: {}, onEvent: vi.fn() });
    capture.start();
    capture.triggerCheckpoint();

    expect(takeFullSnapshot).toHaveBeenCalledOnce();
  });

  it('triggerCheckpoint is safe when takeFullSnapshot is not available', () => {
    const capture = new Capture({ maskingRules: {}, onEvent: vi.fn() });
    capture.start();
    // Should not throw even when takeFullSnapshot doesn't exist
    expect(() => capture.triggerCheckpoint()).not.toThrow();
  });

  it('stop calls the rrweb stop function', () => {
    const capture = new Capture({ maskingRules: {}, onEvent: vi.fn(), onUrlChange: vi.fn() });
    capture.start();
    capture.stop();
    expect(stopFn).toHaveBeenCalledOnce();
  });

  it('stop is safe to call without start', () => {
    const capture = new Capture({ maskingRules: {}, onEvent: vi.fn(), onUrlChange: vi.fn() });
    expect(() => capture.stop()).not.toThrow();
  });

  it('logs error when rrweb is not loaded', () => {
    delete window.rrweb;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const capture = new Capture({ maskingRules: {}, onEvent: vi.fn(), onUrlChange: vi.fn() });
    capture.start();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('rrweb not loaded'));
    consoleSpy.mockRestore();
  });
});
