import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import {
  BASE_URL,
  SECRET_KEY,
  CUSTOMER_ID,
  AGENT_HEADERS,
  fakeIncrementalEvents,
} from './config.js';

/**
 * DOM Events Throughput Test
 *
 * Stress-tests the HTTP relay hot path (POST + GET /dom-events).
 * Creates one session in setup(), then all VUs hammer it with events.
 *
 * This simulates the scenario where Ably is blocked and everything
 * flows through the HTTP relay — the worst-case latency path.
 *
 * Usage:
 *   k6 run -e SECRET_KEY=cb_sk_... -e PUBLIC_KEY=cb_pk_... load-tests/dom-events-throughput.js
 */

const eventsPosted   = new Counter('events_posted_total');
const postLatency    = new Trend('dom_post_latency', true);
const pollLatency    = new Trend('dom_poll_latency', true);

export const options = {
  scenarios: {
    customer_posting: {
      executor: 'constant-vus',
      vus: 10,
      duration: '2m',
      exec: 'postEvents',
    },
    agent_polling: {
      executor: 'constant-vus',
      vus: 5,
      duration: '2m',
      exec: 'pollEvents',
    },
  },
  thresholds: {
    http_req_failed:    ['rate<0.01'],
    dom_post_latency:   ['p(95)<300', 'p(99)<500'],
    dom_poll_latency:   ['p(95)<300', 'p(99)<500'],
  },
};

// ─── Setup: create a session and get tokens ──────────────────────────────────

export function setup() {
  const customerId = `${CUSTOMER_ID}_throughput`;
  const agentId = 'agent_throughput_test';

  // Create session
  const createRes = http.post(
    `${BASE_URL}/api/v1/sessions`,
    JSON.stringify({ agentId, customerId }),
    { headers: AGENT_HEADERS }
  );
  if (createRes.status !== 201) {
    throw new Error(`Setup failed: could not create session (${createRes.status})`);
  }
  const sessionId = createRes.json('sessionId');

  // Approve consent
  const consentRes = http.post(
    `${BASE_URL}/consent/${sessionId}/approve`,
    JSON.stringify({ customerId }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (consentRes.status !== 200) {
    throw new Error(`Setup failed: consent failed (${consentRes.status})`);
  }
  const customerToken = consentRes.json('customerToken');

  return { sessionId, customerToken };
}

// ─── Customer: POST batches of DOM events ────────────────────────────────────

export function postEvents(data) {
  const events = fakeIncrementalEvents(20);
  const res = http.post(
    `${BASE_URL}/api/v1/dom-events/${data.sessionId}`,
    JSON.stringify({ events, customerToken: data.customerToken }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'dom_post' } }
  );
  check(res, { 'post ok (200)': (r) => r.status === 200 });
  postLatency.add(res.timings.duration);
  eventsPosted.add(events.length);
  sleep(0.08); // ~12 batches/sec per VU (matches SDK flush interval)
}

// ─── Agent: poll for DOM events ──────────────────────────────────────────────

export function pollEvents(data) {
  const res = http.get(
    `${BASE_URL}/api/v1/dom-events/${data.sessionId}?since=0`,
    { headers: AGENT_HEADERS, tags: { name: 'dom_poll' } }
  );
  check(res, {
    'poll ok (200)':    (r) => r.status === 200,
    'has events':       (r) => Array.isArray(r.json('events')),
  });
  pollLatency.add(res.timings.duration);
  sleep(0.1); // agent polls every 100ms under load
}

// ─── Teardown: end the session ───────────────────────────────────────────────

export function teardown(data) {
  http.del(`${BASE_URL}/api/v1/sessions/${data.sessionId}`, null, {
    headers: AGENT_HEADERS,
  });
}
