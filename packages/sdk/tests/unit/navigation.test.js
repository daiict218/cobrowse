/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Navigation } from '../../src/navigation.js';

// Mock the logger to silence output during tests
vi.mock('../../src/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('Navigation', () => {
  let onNavigate;
  let nav;
  let origPushState;
  let origReplaceState;

  beforeEach(() => {
    onNavigate = vi.fn();
    // Save real originals before each test
    origPushState = history.pushState;
    origReplaceState = history.replaceState;
  });

  afterEach(() => {
    // Always clean up — stop() should restore, but just in case
    nav?.stop();
    // Force-restore if stop() didn't run or didn't work
    history.pushState = origPushState;
    history.replaceState = origReplaceState;
  });

  it('pushState triggers onNavigate with new URL', () => {
    nav = new Navigation({ onNavigate });
    nav.start();

    history.pushState({}, '', '/page-1');

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining('/page-1'));

    // Clean up URL
    history.replaceState({}, '', '/');
  });

  it('replaceState triggers onNavigate', () => {
    nav = new Navigation({ onNavigate });
    nav.start();

    history.replaceState({}, '', '/replaced');

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining('/replaced'));

    history.replaceState({}, '', '/');
  });

  it('popstate event triggers onNavigate', () => {
    nav = new Navigation({ onNavigate });
    nav.start();

    // In jsdom, pushState changes location.href synchronously
    history.pushState({}, '', '/pop-test');
    onNavigate.mockClear();

    // Simulate back: manually change URL then dispatch popstate
    // (jsdom doesn't do real navigation on popstate)
    history.replaceState({}, '', '/after-pop');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining('/after-pop'));

    history.replaceState({}, '', '/');
  });

  it('hashchange event triggers onNavigate', () => {
    nav = new Navigation({ onNavigate });
    nav.start();

    // Change to a hash URL
    history.replaceState({}, '', '#/hash-route');
    onNavigate.mockClear();

    // Now simulate hashchange with a different hash
    history.replaceState({}, '', '#/new-hash');
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining('#/new-hash'));

    // Clean up
    history.replaceState({}, '', '/');
  });

  it('same-URL pushState does NOT fire onNavigate', () => {
    nav = new Navigation({ onNavigate });
    nav.start();

    const currentPath = location.pathname;
    // pushState to the same URL — should not fire
    history.pushState({}, '', currentPath);

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('stop() restores original history.pushState', () => {
    nav = new Navigation({ onNavigate });
    nav.start();

    expect(history.pushState).not.toBe(origPushState);

    nav.stop();

    expect(history.pushState).toBe(origPushState);
  });

  it('stop() restores original history.replaceState', () => {
    nav = new Navigation({ onNavigate });
    nav.start();

    expect(history.replaceState).not.toBe(origReplaceState);

    nav.stop();

    expect(history.replaceState).toBe(origReplaceState);
  });

  it('stop() removes event listeners', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    nav = new Navigation({ onNavigate });
    nav.start();
    nav.stop();

    expect(removeSpy).toHaveBeenCalledWith('popstate', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('hashchange', expect.any(Function));

    removeSpy.mockRestore();
  });

  it('double start() is idempotent', () => {
    nav = new Navigation({ onNavigate });
    nav.start();
    const patchedPush = history.pushState;

    nav.start(); // second call should be no-op

    // Should still be the same patched function (not double-wrapped)
    expect(history.pushState).toBe(patchedPush);
  });

  it('double stop() is safe', () => {
    nav = new Navigation({ onNavigate });
    nav.start();
    nav.stop();

    // Second stop should not throw
    expect(() => nav.stop()).not.toThrow();
  });

  it('after stop(), pushState does NOT fire onNavigate', () => {
    nav = new Navigation({ onNavigate });
    nav.start();
    nav.stop();

    history.pushState({}, '', '/after-stop');

    expect(onNavigate).not.toHaveBeenCalled();

    // Clean up
    history.replaceState({}, '', '/');
  });
});
