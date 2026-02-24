'use strict';

const { buildMaskSelector, sanitiseEvent } = require('./masking');

/**
 * Capture module — wraps rrweb's record function.
 *
 * Masking is applied at two levels:
 *   1. rrweb config  — maskInputSelector prevents rrweb from ever serializing
 *                      sensitive input values. This is the primary protection.
 *   2. sanitiseEvent — post-capture pass strips any pattern matches that
 *                      escaped level 1 (e.g. card number pasted into a div).
 */

class Capture {
  constructor({ maskingRules, onEvent, onUrlChange }) {
    this._rules      = maskingRules || {};
    this._onEvent    = onEvent;
    this._onUrlChange = onUrlChange;
    this._stopFn     = null;
    this._lastUrl    = location.href;
  }

  start() {
    const rrweb = window.rrweb;
    if (!rrweb || !rrweb.record) {
      console.error('[CoBrowse] rrweb not loaded. Ensure rrweb is available on the page.');
      return;
    }

    console.debug('[CoBrowse] Capture.start(): rrweb found, starting record(). readyState=', document.readyState);

    const maskSelector = buildMaskSelector(this._rules);

    this._stopFn = rrweb.record({
      emit: (event) => {
        console.debug('[CoBrowse] Capture emit called, event.type=', event && event.type);
        // Level 2 masking — post-capture pass to catch any PII that slipped through
        // (e.g. card numbers pasted into a <div contenteditable>)
        const safe = sanitiseEvent(event, this._rules);
        this._onEvent(safe);

        // Detect navigation changes (SPA routing via pushState)
        if (location.href !== this._lastUrl) {
          this._lastUrl = location.href;
          this._onUrlChange(location.href);
        }
      },

      // ─── rrweb privacy options ───────────────────────────────────────────────

      // Block entire elements from capture (hard-block PII containers)
      blockSelector: '[data-cobrowse-block]',

      // Level 1 masking — rrweb replaces sensitive input VALUES with '████'
      // BEFORE the event is serialised. The value never leaves the browser.
      // maskInputOptions masks by type (e.g. password); maskInputFn handles
      // arbitrary CSS selectors (CVV, OTP, phone, account numbers etc).
      maskInputOptions: { password: true },
      maskInputFn: (text, element) => {
        if (!maskSelector || !element?.matches) return text;
        try {
          return element.matches(maskSelector) ? '████' : text;
        } catch {
          return text;
        }
      },

      // Capture options
      recordCanvas: false,     // Canvas capture is heavy — skip for MVP
      collectFonts: false,     // Reduces snapshot size
      inlineImages: false,     // Don't inline image data — just reference URLs

      // Sampling — throttle high-frequency events to keep Ably bandwidth manageable.
      // NOTE: We do NOT set sampling.input — rrweb defaults to capturing both
      // 'input' (every keystroke) AND 'change' events. This lets the agent see
      // values as the customer types rather than only after they blur each field.
      sampling: {
        mousemove: 50,   // max 1 mousemove event per 50ms
        scroll:    150,
      },
    });

    if (this._stopFn) {
      console.debug('[CoBrowse] Capture.start(): rrweb.record() returned successfully');
    } else {
      console.error('[CoBrowse] Capture.start(): rrweb.record() returned null/undefined — recording failed!');
    }
  }

  stop() {
    if (this._stopFn) {
      this._stopFn();
      this._stopFn = null;
    }
  }
}

module.exports = { Capture };
