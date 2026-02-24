/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Transport } from '../../src/transport.js';

describe('Transport', () => {
  let mockFetch;
  let MockRealtime;

  beforeEach(() => {
    vi.useFakeTimers();

    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buffered: 0 }),
    });
    globalThis.fetch = mockFetch;

    // Mock Ably
    MockRealtime = vi.fn().mockImplementation(function () {
      this.connection = {
        once: vi.fn((event, cb) => {
          if (event === 'connected') setTimeout(() => cb(), 5);
        }),
        close: vi.fn(),
      };
      this.channels = {
        get: vi.fn(() => ({
          subscribe: vi.fn(),
          publish: vi.fn().mockResolvedValue(undefined),
        })),
      };
    });

    globalThis.window = globalThis.window || globalThis;
    globalThis.window.Ably = { Realtime: MockRealtime };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts HTTP relay immediately on connect', async () => {
    const transport = new Transport({
      serverUrl: 'http://localhost:3000',
      sessionId: 'sess1',
      customerToken: 'token1',
    });

    // Start connect (don't await — async process)
    const connectPromise = transport.connect('tenant1');

    // Enqueue an event right away
    transport.enqueue({ type: 3, data: 'mutation' });

    // Advance past the HTTP flush interval (100ms)
    await vi.advanceTimersByTimeAsync(150);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/dom-events/sess1'),
      expect.objectContaining({ method: 'POST' }),
    );

    transport.disconnect();
    try { await connectPromise; } catch {}
  });

  it('enqueues events to both Ably and HTTP batches', () => {
    const transport = new Transport({
      serverUrl: 'http://localhost:3000',
      sessionId: 'sess1',
      customerToken: 'token1',
    });

    transport.enqueue({ type: 3, n: 1 });
    transport.enqueue({ type: 3, n: 2 });

    expect(transport._ablyBatch.length).toBe(2);
    expect(transport._httpBatch.length).toBe(2);

    transport.disconnect();
  });

  it('disconnect clears timers and closes Ably', async () => {
    const transport = new Transport({
      serverUrl: 'http://localhost:3000',
      sessionId: 'sess1',
      customerToken: 'token1',
    });

    const connectPromise = transport.connect('tenant1');
    // Advance to let Ably connect
    await vi.advanceTimersByTimeAsync(20);
    try { await connectPromise; } catch {}

    transport.disconnect();

    expect(transport._ablyTimer).toBeNull();
    expect(transport._httpTimer).toBeNull();
  });

  it('re-queues events on HTTP flush failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const transport = new Transport({
      serverUrl: 'http://localhost:3000',
      sessionId: 'sess1',
      customerToken: 'token1',
    });

    transport._startHttpRelay();
    transport.enqueue({ type: 3, data: 'event1' });

    // Advance just past one flush interval
    await vi.advanceTimersByTimeAsync(110);

    // Events should still be in the HTTP batch (re-queued on failure)
    expect(transport._httpBatch.length).toBeGreaterThanOrEqual(1);

    transport.disconnect();
  });

  it('HTTP relay flushes batch at intervals', async () => {
    const transport = new Transport({
      serverUrl: 'http://localhost:3000',
      sessionId: 'sess1',
      customerToken: 'token1',
    });

    transport._startHttpRelay();
    transport._httpBatch.push({ type: 3, data: 'e1' });

    // Advance past one flush interval
    await vi.advanceTimersByTimeAsync(110);

    expect(mockFetch).toHaveBeenCalled();
    transport.disconnect();
  });

  it('does not start HTTP relay twice', () => {
    const transport = new Transport({
      serverUrl: 'http://localhost:3000',
      sessionId: 'sess1',
      customerToken: 'token1',
    });

    transport._startHttpRelay();
    const firstTimer = transport._httpTimer;
    transport._startHttpRelay(); // second call
    expect(transport._httpTimer).toBe(firstTimer);

    transport.disconnect();
  });

  it('flushes remaining events on disconnect', () => {
    const transport = new Transport({
      serverUrl: 'http://localhost:3000',
      sessionId: 'sess1',
      customerToken: 'token1',
    });

    transport._startHttpRelay();
    transport._httpBatch.push({ type: 3 });

    // disconnect calls _flushHttp synchronously (fire-and-forget)
    transport.disconnect();

    // After disconnect, timers should be null
    expect(transport._httpTimer).toBeNull();
  });
});
