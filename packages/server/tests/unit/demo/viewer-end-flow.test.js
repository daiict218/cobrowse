import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Helpers ─────────────────────────────────────────────────────────────────────

/**
 * Simulates the endSession + teardown flow from demo agent app.js.
 * Extracted so we can test the postMessage + teardown guard logic
 * without a full browser environment.
 *
 * @param {object} deps — injectable dependencies
 * @param {string} deps.sessionId
 * @param {object|null} deps.viewerWindow — mock window.open() result
 * @param {function} deps.apiCall — async (method, path) => result
 * @param {function} deps.onTeardown — called with (reason) when teardown fires
 * @returns {{ endSession: function, teardown: function }}
 */
function createEndSessionFlow({ sessionId, viewerWindow, apiCall, onTeardown }) {
  let tornDown = false;
  let currentSessionId = sessionId;

  function teardown(reason) {
    if (tornDown) return;
    tornDown = true;
    onTeardown(reason);
    // Reset after delay (simulates the setTimeout in real code)
    setTimeout(() => { tornDown = false; }, 2000);
  }

  async function endSession() {
    if (!currentSessionId) return;
    await apiCall('DELETE', `/api/v1/sessions/${currentSessionId}`);
    // Notify viewer window to show clean end state before closing
    if (viewerWindow && !viewerWindow.closed) {
      viewerWindow.postMessage({ action: 'sessionEndedByAgent' }, '*');
    }
    teardown('agent');
  }

  return { endSession, teardown };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Viewer end flow (agent demo)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('endSession() sends postMessage to viewer before teardown', async () => {
    const mockViewer = {
      closed: false,
      postMessage: vi.fn(),
    };

    const onTeardown = vi.fn();
    const apiCall = vi.fn().mockResolvedValue({});

    const flow = createEndSessionFlow({
      sessionId: 'sess_123',
      viewerWindow: mockViewer,
      apiCall,
      onTeardown,
    });

    await flow.endSession();

    // postMessage should have been called before teardown
    expect(mockViewer.postMessage).toHaveBeenCalledWith(
      { action: 'sessionEndedByAgent' },
      '*',
    );
    expect(onTeardown).toHaveBeenCalledWith('agent');

    // postMessage called first, then teardown
    const postMsgOrder = mockViewer.postMessage.mock.invocationCallOrder[0];
    const teardownOrder = onTeardown.mock.invocationCallOrder[0];
    expect(postMsgOrder).toBeLessThan(teardownOrder);
  });

  it('endSession() skips postMessage when viewer is closed', async () => {
    const mockViewer = {
      closed: true,
      postMessage: vi.fn(),
    };

    const onTeardown = vi.fn();
    const apiCall = vi.fn().mockResolvedValue({});

    const flow = createEndSessionFlow({
      sessionId: 'sess_123',
      viewerWindow: mockViewer,
      apiCall,
      onTeardown,
    });

    await flow.endSession();

    expect(mockViewer.postMessage).not.toHaveBeenCalled();
    expect(onTeardown).toHaveBeenCalledWith('agent');
  });

  it('endSession() skips postMessage when viewerWindow is null', async () => {
    const onTeardown = vi.fn();
    const apiCall = vi.fn().mockResolvedValue({});

    const flow = createEndSessionFlow({
      sessionId: 'sess_123',
      viewerWindow: null,
      apiCall,
      onTeardown,
    });

    await flow.endSession();

    expect(onTeardown).toHaveBeenCalledWith('agent');
  });

  it('teardown guard prevents double invocation', () => {
    const onTeardown = vi.fn();
    const apiCall = vi.fn().mockResolvedValue({});

    const flow = createEndSessionFlow({
      sessionId: 'sess_123',
      viewerWindow: null,
      apiCall,
      onTeardown,
    });

    flow.teardown('agent');
    flow.teardown('ended');

    // Only first call should fire
    expect(onTeardown).toHaveBeenCalledTimes(1);
    expect(onTeardown).toHaveBeenCalledWith('agent');
  });

  it('teardown guard resets after timeout, allowing next session', () => {
    const onTeardown = vi.fn();
    const apiCall = vi.fn().mockResolvedValue({});

    const flow = createEndSessionFlow({
      sessionId: 'sess_123',
      viewerWindow: null,
      apiCall,
      onTeardown,
    });

    flow.teardown('agent');
    expect(onTeardown).toHaveBeenCalledTimes(1);

    // Fast-forward past the reset timer
    vi.advanceTimersByTime(2000);

    // Now teardown should work again (new session)
    flow.teardown('ended');
    expect(onTeardown).toHaveBeenCalledTimes(2);
  });
});
