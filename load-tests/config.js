/**
 * Shared configuration and helpers for k6 load tests.
 *
 * Environment variables (pass via -e flag or k6 env):
 *   BASE_URL    — server base URL (default: http://localhost:4000)
 *   SECRET_KEY  — tenant secret key (cb_sk_...)
 *   PUBLIC_KEY  — tenant public key (cb_pk_...)
 *   CUSTOMER_ID — default customer ID for tests
 */

export const BASE_URL    = __ENV.BASE_URL    || 'http://localhost:4000';
export const SECRET_KEY  = __ENV.SECRET_KEY  || '';
export const PUBLIC_KEY  = __ENV.PUBLIC_KEY   || '';
export const CUSTOMER_ID = __ENV.CUSTOMER_ID || 'cust_load_test';

export const AGENT_HEADERS = {
  'Content-Type': 'application/json',
  'X-API-Key': SECRET_KEY,
};

export const PUBLIC_HEADERS = {
  'Content-Type': 'application/json',
  'X-CB-Public-Key': PUBLIC_KEY,
};

/**
 * Build headers for customer-authenticated requests.
 */
export function customerHeaders(customerToken) {
  return {
    'Content-Type': 'application/json',
    'X-Customer-Token': customerToken,
  };
}

/**
 * Generate a fake rrweb Meta event (type 4).
 */
export function fakeMeta() {
  return {
    type: 4,
    data: { href: 'http://example.com', width: 1920, height: 1080 },
    timestamp: Date.now(),
  };
}

/**
 * Generate a fake rrweb FullSnapshot event (type 2).
 * Size is roughly proportional to nodeCount.
 */
export function fakeFullSnapshot(nodeCount = 50) {
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      type: 2,
      tagName: 'div',
      attributes: { class: `node-${i}` },
      childNodes: [],
      id: i + 1,
    });
  }
  return {
    type: 2,
    data: {
      node: { type: 0, childNodes: nodes, id: 0 },
      initialOffset: { left: 0, top: 0 },
    },
    timestamp: Date.now(),
  };
}

/**
 * Generate a batch of fake incremental rrweb events (type 3).
 */
export function fakeIncrementalEvents(count = 10) {
  const events = [];
  for (let i = 0; i < count; i++) {
    events.push({
      type: 3,
      data: {
        source: 1, // mousemove
        positions: [{ x: Math.random() * 1920, y: Math.random() * 1080, id: 1, timeOffset: 0 }],
      },
      timestamp: Date.now() + i,
    });
  }
  return events;
}

/**
 * Thresholds reused across scenarios.
 */
export const DEFAULT_THRESHOLDS = {
  http_req_failed:   ['rate<0.01'],         // <1% errors
  http_req_duration: ['p(95)<2000'],         // P95 < 2s
};
