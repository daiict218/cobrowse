import { Session } from './session.js';

/**
 * CoBrowse SDK — public API
 *
 * Embed on a client's website:
 *   <script src="https://cdn.cobrowse.io/cobrowse.js"></script>
 *   <script>
 *     CoBrowse.init({
 *       serverUrl:  'https://api.cobrowse.io',
 *       publicKey:  'cb_pk_...',
 *       customerId: 'user_123',           // unique, stable ID for this customer
 *       onStateChange: (state) => { ... } // optional: 'idle' | 'invited' | 'active' | 'ended'
 *     });
 *   </script>
 *
 * The SDK is intentionally minimal. Phase 2 capabilities (agent control, etc.)
 * are added as plugins via CoBrowse.use(plugin).
 */

let _session = null;
const _plugins = [];

const CoBrowse = {
  /**
   * Initialise the SDK. Must be called once per page load.
   *
   * @param {object} options
   * @param {string} options.serverUrl   — Base URL of the CoBrowse session server
   * @param {string} options.publicKey   — Tenant public key (cb_pk_...)
   * @param {string} options.customerId  — Unique customer identifier
   * @param {Function} [options.onStateChange] — State change callback
   */
  async init({ serverUrl, publicKey, customerId, onStateChange }) {
    if (_session) {
      console.warn('[CoBrowse] Already initialised. Call CoBrowse.destroy() first.');
      return;
    }

    if (!serverUrl || !publicKey || !customerId) {
      throw new Error('[CoBrowse] serverUrl, publicKey, and customerId are required');
    }

    // Warn if SDK is communicating over insecure HTTP in production
    if (typeof window !== 'undefined' &&
        !serverUrl.startsWith('https://') &&
        !serverUrl.includes('localhost') &&
        !serverUrl.includes('127.0.0.1')) {
      console.warn('[CoBrowse] WARNING: serverUrl uses HTTP. Tokens and session data are sent unencrypted. Use HTTPS in production.');
    }

    // Fetch tenant masking rules before starting capture
    const maskingRules = await _fetchMaskingRules(serverUrl, publicKey);

    _session = new Session({
      serverUrl,
      publicKey,
      customerId,
      onStateChange: (state) => {
        // Notify plugins
        _plugins.forEach((p) => p.onStateChange?.(state));
        onStateChange?.(state);
      },
    });

    await _session.init(maskingRules);

    // Initialise plugins
    _plugins.forEach((p) => p.init?.(_session));

    console.info('[CoBrowse] Initialised. Customer ID:', customerId);
  },

  /**
   * Register a plugin. Plugins extend SDK behaviour (e.g. Phase 2 agent control).
   * Must be called before init().
   *
   * Plugin shape:
   *   { init(session) { ... }, onStateChange(state) { ... } }
   */
  use(plugin) {
    if (typeof plugin !== 'object' || plugin === null) {
      throw new Error('[CoBrowse] Plugin must be an object');
    }
    _plugins.push(plugin);
    return CoBrowse; // chainable: CoBrowse.use(pluginA).use(pluginB).init(...)
  },

  /**
   * Programmatically end the current session (called by customer).
   */
  endSession() {
    _session?._endByCustomer();
  },

  /**
   * Tear down the SDK completely. Call this on SPA route unmount if needed.
   */
  destroy() {
    _session?._cleanup('destroy');
    _session = null;
  },

  /**
   * Get current session state.
   */
  getState() {
    return _session?._state || 'idle';
  },
};

// Fail-closed defaults: if we can't fetch rules, mask common sensitive patterns anyway
const FALLBACK_MASKING_RULES = {
  selectors: [],
  maskTypes: ['password'],
  patterns: [],
};

async function _fetchMaskingRules(serverUrl, publicKey) {
  try {
    const res = await fetch(`${serverUrl}/api/v1/public/masking-rules`, {
      headers: { 'X-CB-Public-Key': publicKey },
    });
    if (!res.ok) return FALLBACK_MASKING_RULES;
    const data = await res.json();
    return data.maskingRules || FALLBACK_MASKING_RULES;
  } catch {
    // Fail-closed: use built-in defaults so masking is never completely disabled
    console.warn('[CoBrowse] Could not fetch masking rules, using built-in defaults');
    return FALLBACK_MASKING_RULES;
  }
}

// Export for both ESM (bundled SDK) and browser global
export default CoBrowse;
if (typeof window !== 'undefined') window.CoBrowse = CoBrowse;
