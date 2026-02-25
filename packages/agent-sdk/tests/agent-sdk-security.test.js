/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import SDK from '../src/index.js';

describe('Agent SDK Security', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('postMessage source validation', () => {
    it('ignores messages from unknown sources', () => {
      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'test-jwt' });
      const cb = vi.fn();
      agent.on('session.stateChange', cb);

      // Simulate a message from an unknown source (not a viewer window)
      const event = new MessageEvent('message', {
        data: { type: 'session.stateChange', state: 'ended' },
        source: window, // self, not a viewer window
      });
      window.dispatchEvent(event);

      expect(cb).not.toHaveBeenCalled();
      agent.destroy();
    });

    it('accepts messages from known viewer windows', () => {
      const mockViewerWin = { closed: false, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(mockViewerWin);

      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'test-jwt' });
      const cb = vi.fn();
      agent.on('session.stateChange', cb);

      // Open a viewer window
      agent.openViewer('sess-test');

      // Simulate a message from the viewer window
      const event = new MessageEvent('message', {
        data: { type: 'session.stateChange', state: 'ended' },
        source: mockViewerWin,
      });
      window.dispatchEvent(event);

      expect(cb).toHaveBeenCalledWith({ type: 'session.stateChange', state: 'ended' });
      agent.destroy();
    });

    it('ignores non-object messages', () => {
      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'test-jwt' });
      const cb = vi.fn();
      agent.on('session.stateChange', cb);

      const event = new MessageEvent('message', {
        data: 'string-message',
        source: window,
      });
      window.dispatchEvent(event);

      expect(cb).not.toHaveBeenCalled();
      agent.destroy();
    });

    it('ignores null messages', () => {
      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'test-jwt' });
      const cb = vi.fn();
      agent.on('session.stateChange', cb);

      const event = new MessageEvent('message', {
        data: null,
        source: window,
      });
      window.dispatchEvent(event);

      expect(cb).not.toHaveBeenCalled();
      agent.destroy();
    });
  });

  describe('JWT token in viewer URL', () => {
    it('encodes JWT token in viewer URL', () => {
      const mockWin = { closed: false, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(mockWin);

      const jwtWithSpecialChars = 'eyJhbGciOiJSUzI1NiJ9.eyJ0ZW5hbnRJZCI6InRlc3QifQ.signature+with/special=chars';
      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: jwtWithSpecialChars });
      agent.openViewer('sess-encode-test');

      const [url] = window.open.mock.calls[0];
      // JWT should be URI-encoded in the URL
      expect(url).toContain('token=' + encodeURIComponent(jwtWithSpecialChars));

      agent.destroy();
    });
  });

  describe('destroy cleans up message listener', () => {
    it('removes message event listener on destroy', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'test-jwt' });
      agent.destroy();

      expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('clears all listeners on destroy', () => {
      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'test-jwt' });
      const cb = vi.fn();
      agent.on('session.created', cb);

      agent.destroy();

      // Internal listeners map should be empty
      agent._emit('session.created', { test: true });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('endSession closes viewer window', () => {
    it('closes the viewer window for the ended session', async () => {
      const mockWin = { closed: false, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(mockWin);
      fetchMock.mockResolvedValue({ ok: true, status: 204, json: () => Promise.resolve({}) });

      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'test-jwt' });
      agent.openViewer('sess-close-test');

      await agent.endSession('sess-close-test');

      expect(mockWin.close).toHaveBeenCalled();
      agent.destroy();
    });

    it('does not throw if viewer window already closed', async () => {
      const mockWin = { closed: true, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(mockWin);
      fetchMock.mockResolvedValue({ ok: true, status: 204, json: () => Promise.resolve({}) });

      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'test-jwt' });
      agent.openViewer('sess-already-closed');

      await expect(agent.endSession('sess-already-closed')).resolves.not.toThrow();
      expect(mockWin.close).not.toHaveBeenCalled(); // already closed
      agent.destroy();
    });
  });
});
