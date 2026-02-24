/**
 * Client-side masking engine.
 *
 * Masking MUST happen in the browser before any data leaves the customer's device.
 * This is the only approach that satisfies PCI DSS, HIPAA, and GDPR requirements
 * because sensitive values never travel over the wire at all.
 *
 * Two layers of masking:
 *   1. rrweb-level  — pass selectors to rrweb's maskInputSelector option so rrweb
 *                     itself never serializes the input values.
 *   2. Post-capture — scan serialised events for patterns that slipped through
 *                     (e.g. card numbers typed into a plain <div contenteditable>).
 *
 * Rules are fetched from the server on SDK init and cached for the session.
 */

// ─── Default rules (always applied, regardless of tenant config) ──────────────

const DEFAULT_MASK_TYPES = ['password'];

const DEFAULT_SELECTORS = [
  'input[type="password"]',
  'input[autocomplete*="cc-"]',         // credit card fields
  'input[autocomplete="cc-number"]',
  'input[autocomplete="cc-csc"]',
  'input[name*="card"]',
  'input[name*="cvv"]',
  'input[name*="cvc"]',
  'input[name*="otp"]',
  'input[name*="pin"]',
  'input[id*="card"]',
  'input[id*="cvv"]',
  'input[id*="otp"]',
];

// Regex patterns applied to text content in DOM events (post-capture defence-in-depth).
// NOTE: Do NOT add generic short-number patterns here — they mask legitimate values
// like incident numbers, dates, and loss amounts. Sensitive fields (CVV, OTP, card)
// are already masked at the rrweb level via DEFAULT_SELECTORS above, so they never
// enter the event stream in the first place.
const DEFAULT_PATTERNS = [
  /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/g, // 16-digit card numbers (PAN)
];

/**
 * Build the combined CSS selector string for rrweb's maskInputSelector option.
 * Merges tenant-configured selectors with the defaults.
 *
 * @param {object} rules — tenant masking rules from server
 * @returns {string} CSS selector string
 */
function buildMaskSelector(rules = {}) {
  const tenantSelectors = rules.selectors || [];
  const tenantTypes     = rules.maskTypes  || [];

  const typeSelectors = [...DEFAULT_MASK_TYPES, ...tenantTypes]
    .map((t) => `input[type="${t}"]`);

  const all = [...new Set([...DEFAULT_SELECTORS, ...typeSelectors, ...tenantSelectors])];
  return all.join(', ');
}

/**
 * Post-capture event sanitiser.
 * Walks a serialised rrweb event tree and redacts pattern matches.
 *
 * This is a defence-in-depth measure. The primary masking happens via rrweb's
 * maskInputSelector — this catches anything that slips through.
 *
 * @param {object} event — rrweb event
 * @param {object} rules — tenant masking rules
 * @returns {object} sanitised event (new object, original is not mutated)
 */
function sanitiseEvent(event, rules = {}) {
  const patterns = [
    ...DEFAULT_PATTERNS,
    ...(rules.patterns || []).map((p) => new RegExp(p, 'g')),
  ];

  if (!patterns.length) return event;
  return _deepRedact(event, patterns);
}

function _deepRedact(obj, patterns) {
  if (typeof obj === 'string') {
    return patterns.reduce((str, re) => str.replace(re, '████'), obj);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => _deepRedact(item, patterns));
  }
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const key of Object.keys(obj)) {
      // Never redact structural rrweb keys — only data/value fields
      if (key === 'type' || key === 'id' || key === 'timestamp') {
        out[key] = obj[key];
      } else {
        out[key] = _deepRedact(obj[key], patterns);
      }
    }
    return out;
  }
  return obj;
}

export { buildMaskSelector, sanitiseEvent };
