import { log } from './logger.js';

/**
 * Navigation module — proactively detects SPA route changes.
 *
 * Covers all client-side navigation methods:
 *   - history.pushState()  — SPA router navigations
 *   - history.replaceState() — URL rewrites without new history entry
 *   - popstate event       — browser back/forward buttons
 *   - hashchange event     — hash-based SPA routing (#/page)
 *
 * Fires onNavigate(url) only when the URL actually changes (deduplicated).
 * stop() restores all originals and removes listeners.
 */

class Navigation {
  constructor({ onNavigate }) {
    this._onNavigate = onNavigate;
    this._lastUrl = null;
    this._started = false;

    // Saved originals for restore
    this._origPushState = null;
    this._origReplaceState = null;

    // Bound listeners for clean removal
    this._onPopState = () => this._checkUrl();
    this._onHashChange = () => this._checkUrl();
  }

  start() {
    if (this._started) return; // idempotent
    this._started = true;
    this._lastUrl = location.href;

    // Monkey-patch history.pushState
    this._origPushState = history.pushState;
    const self = this;
    history.pushState = function (...args) {
      self._origPushState.apply(this, args);
      self._checkUrl();
    };

    // Monkey-patch history.replaceState
    this._origReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      self._origReplaceState.apply(this, args);
      self._checkUrl();
    };

    // Listen for back/forward and hash changes
    window.addEventListener('popstate', this._onPopState);
    window.addEventListener('hashchange', this._onHashChange);

    log.debug('[CoBrowse] Navigation: started monitoring SPA route changes');
  }

  stop() {
    if (!this._started) return; // idempotent
    this._started = false;

    // Restore originals
    if (this._origPushState) {
      history.pushState = this._origPushState;
      this._origPushState = null;
    }
    if (this._origReplaceState) {
      history.replaceState = this._origReplaceState;
      this._origReplaceState = null;
    }

    // Remove listeners
    window.removeEventListener('popstate', this._onPopState);
    window.removeEventListener('hashchange', this._onHashChange);

    log.debug('[CoBrowse] Navigation: stopped monitoring');
  }

  _checkUrl() {
    const currentUrl = location.href;
    if (currentUrl !== this._lastUrl) {
      this._lastUrl = currentUrl;
      this._onNavigate(currentUrl);
    }
  }
}

export { Navigation };
