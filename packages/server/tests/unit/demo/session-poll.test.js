import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Helpers ─────────────────────────────────────────────────────────────────────

/**
 * Simulates the fixed startSessionPoll() from the server demo agent app.js.
 * Extracted so we can test the polling logic without a full browser environment.
 *
 * @param {object} deps — injectable dependencies
 * @param {string} deps.sessionId
 * @param {function} deps.apiCall — async (method, path) => { status, endReason? }
 * @param {function} deps.onActive — called once when session becomes active
 * @param {function} deps.onEnded — called when session ends (with reason)
 * @returns {{ interval: number|null, teardown: function }}
 */
function startSessionPoll({ sessionId, apiCall, onActive, onEnded }) {
  let sessionActive = false;
  let pollInterval = null;

  pollInterval = setInterval(async () => {
    if (!sessionId) return;

    try {
      const res = await apiCall('GET', `/api/v1/sessions/${sessionId}`);

      if (res.status === 'active' && !sessionActive) {
        sessionActive = true;
        onActive();
      } else if (res.status === 'ended') {
        clearInterval(pollInterval);
        pollInterval = null;
        onEnded(res.endReason || 'unknown');
      }
    } catch { /* non-fatal */ }
  }, 2000);

  function teardown() {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  return {
    get interval() { return pollInterval; },
    teardown,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('startSessionPoll (agent demo)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls apiCall every 2 seconds', async () => {
    const apiCall = vi.fn().mockResolvedValue({ status: 'pending' });
    const poll = startSessionPoll({
      sessionId: 'sess_1',
      apiCall,
      onActive: vi.fn(),
      onEnded: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(apiCall).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(apiCall).toHaveBeenCalledTimes(2);

    poll.teardown();
  });

  it('calls onActive when session becomes active', async () => {
    const onActive = vi.fn();
    const apiCall = vi.fn().mockResolvedValue({ status: 'active' });

    const poll = startSessionPoll({
      sessionId: 'sess_1',
      apiCall,
      onActive,
      onEnded: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(onActive).toHaveBeenCalledTimes(1);

    poll.teardown();
  });

  it('continues polling after session becomes active', async () => {
    const apiCall = vi.fn().mockResolvedValue({ status: 'active' });
    const onActive = vi.fn();

    const poll = startSessionPoll({
      sessionId: 'sess_1',
      apiCall,
      onActive,
      onEnded: vi.fn(),
    });

    // First poll — becomes active
    await vi.advanceTimersByTimeAsync(2000);
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(poll.interval).not.toBeNull(); // interval still running

    // Second poll — still active, polling continues
    await vi.advanceTimersByTimeAsync(2000);
    expect(apiCall).toHaveBeenCalledTimes(2);

    // Third poll — still going
    await vi.advanceTimersByTimeAsync(2000);
    expect(apiCall).toHaveBeenCalledTimes(3);

    poll.teardown();
  });

  it('does not call onActive more than once', async () => {
    const onActive = vi.fn();
    const apiCall = vi.fn().mockResolvedValue({ status: 'active' });

    const poll = startSessionPoll({
      sessionId: 'sess_1',
      apiCall,
      onActive,
      onEnded: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onActive).toHaveBeenCalledTimes(1);

    poll.teardown();
  });

  it('stops polling when session becomes ended', async () => {
    const onEnded = vi.fn();
    const apiCall = vi.fn()
      .mockResolvedValueOnce({ status: 'active' })
      .mockResolvedValueOnce({ status: 'active' })
      .mockResolvedValueOnce({ status: 'ended', endReason: 'customer' });

    const poll = startSessionPoll({
      sessionId: 'sess_1',
      apiCall,
      onActive: vi.fn(),
      onEnded,
    });

    // Poll 1 — active
    await vi.advanceTimersByTimeAsync(2000);
    expect(onEnded).not.toHaveBeenCalled();

    // Poll 2 — still active
    await vi.advanceTimersByTimeAsync(2000);
    expect(onEnded).not.toHaveBeenCalled();

    // Poll 3 — ended
    await vi.advanceTimersByTimeAsync(2000);
    expect(onEnded).toHaveBeenCalledWith('customer');

    // No more polls after ended
    const callCount = apiCall.mock.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(apiCall).toHaveBeenCalledTimes(callCount);
  });

  it('detects active → ended transition', async () => {
    const onActive = vi.fn();
    const onEnded = vi.fn();
    const apiCall = vi.fn()
      .mockResolvedValueOnce({ status: 'pending' })
      .mockResolvedValueOnce({ status: 'active' })
      .mockResolvedValueOnce({ status: 'active' })
      .mockResolvedValueOnce({ status: 'ended', endReason: 'timeout' });

    const poll = startSessionPoll({
      sessionId: 'sess_1',
      apiCall,
      onActive,
      onEnded,
    });

    // Poll 1 — pending
    await vi.advanceTimersByTimeAsync(2000);
    expect(onActive).not.toHaveBeenCalled();

    // Poll 2 — active
    await vi.advanceTimersByTimeAsync(2000);
    expect(onActive).toHaveBeenCalledTimes(1);

    // Poll 3 — still active (polling continues!)
    await vi.advanceTimersByTimeAsync(2000);
    expect(apiCall).toHaveBeenCalledTimes(3);

    // Poll 4 — ended
    await vi.advanceTimersByTimeAsync(2000);
    expect(onEnded).toHaveBeenCalledWith('timeout');
  });

  it('teardown clears the poll interval', async () => {
    const apiCall = vi.fn().mockResolvedValue({ status: 'active' });

    const poll = startSessionPoll({
      sessionId: 'sess_1',
      apiCall,
      onActive: vi.fn(),
      onEnded: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(2000);
    const callsBefore = apiCall.mock.calls.length;

    poll.teardown();

    await vi.advanceTimersByTimeAsync(6000);
    expect(apiCall).toHaveBeenCalledTimes(callsBefore);
  });

  it('handles apiCall errors gracefully (non-fatal)', async () => {
    const apiCall = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ status: 'active' });

    const onActive = vi.fn();

    const poll = startSessionPoll({
      sessionId: 'sess_1',
      apiCall,
      onActive,
      onEnded: vi.fn(),
    });

    // Poll 1 — error, swallowed
    await vi.advanceTimersByTimeAsync(2000);
    expect(onActive).not.toHaveBeenCalled();

    // Poll 2 — recovers
    await vi.advanceTimersByTimeAsync(2000);
    expect(onActive).toHaveBeenCalledTimes(1);

    poll.teardown();
  });

  it('passes endReason "unknown" when server omits it', async () => {
    const onEnded = vi.fn();
    const apiCall = vi.fn().mockResolvedValue({ status: 'ended' });

    const poll = startSessionPoll({
      sessionId: 'sess_1',
      apiCall,
      onActive: vi.fn(),
      onEnded,
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(onEnded).toHaveBeenCalledWith('unknown');
  });
});
