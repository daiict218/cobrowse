import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import {
  BASE_URL,
  SECRET_KEY,
  PUBLIC_KEY,
  CUSTOMER_ID,
  AGENT_HEADERS,
  customerHeaders,
  fakeMeta,
  fakeFullSnapshot,
  fakeIncrementalEvents,
} from './config.js';

/**
 * Session Lifecycle Load Test
 *
 * Simulates the full co-browse flow per virtual user:
 *   1. Agent creates session
 *   2. Customer approves consent
 *   3. Customer uploads initial snapshot
 *   4. Customer streams DOM events (5 batches)
 *   5. Agent polls for DOM events
 *   6. Agent fetches snapshot
 *   7. Agent ends session
 *
 * Usage:
 *   k6 run -e SECRET_KEY=cb_sk_... -e PUBLIC_KEY=cb_pk_... load-tests/session-lifecycle.js
 */

// ─── Custom metrics ──────────────────────────────────────────────────────────

const sessionCreateDuration = new Trend('session_create_duration', true);
const consentDuration       = new Trend('consent_approve_duration', true);
const snapshotUploadDuration = new Trend('snapshot_upload_duration', true);
const domEventPostDuration  = new Trend('dom_event_post_duration', true);
const sessionEndDuration    = new Trend('session_end_duration', true);
const lifecycleErrors       = new Rate('lifecycle_errors');

// ─── Options ─────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    lifecycle: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 5 },   // ramp up
        { duration: '1m',  target: 10 },   // sustained load
        { duration: '30s', target: 20 },   // peak
        { duration: '30s', target: 0 },    // ramp down
      ],
    },
  },
  thresholds: {
    http_req_failed:            ['rate<0.05'],      // <5% errors
    http_req_duration:          ['p(95)<3000'],      // P95 < 3s
    session_create_duration:    ['p(95)<1000'],      // session create < 1s
    consent_approve_duration:   ['p(95)<1500'],      // consent < 1.5s
    snapshot_upload_duration:   ['p(95)<2000'],      // snapshot upload < 2s
    dom_event_post_duration:    ['p(95)<500'],       // DOM event POST < 500ms
    session_end_duration:       ['p(95)<1000'],      // session end < 1s
    lifecycle_errors:           ['rate<0.05'],       // <5% full-flow failures
  },
};

// ─── Main scenario ───────────────────────────────────────────────────────────

export default function () {
  const vu = __VU;
  const iter = __ITER;
  const customerId = `${CUSTOMER_ID}_${vu}_${iter}`;
  const agentId = `agent_load_${vu}_${iter}`;

  // 1. Agent creates session
  const createRes = http.post(
    `${BASE_URL}/api/v1/sessions`,
    JSON.stringify({ agentId, customerId }),
    { headers: AGENT_HEADERS, tags: { name: 'create_session' } }
  );

  const createOk = check(createRes, {
    'session created (201)': (r) => r.status === 201,
    'has sessionId':         (r) => !!r.json('sessionId'),
  });

  if (!createOk) {
    lifecycleErrors.add(1);
    return;
  }

  sessionCreateDuration.add(createRes.timings.duration);
  const sessionId = createRes.json('sessionId');

  sleep(0.2);

  // 2. Customer approves consent
  const consentRes = http.post(
    `${BASE_URL}/consent/${sessionId}/approve`,
    JSON.stringify({ customerId }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'consent_approve' } }
  );

  const consentOk = check(consentRes, {
    'consent approved (200)':  (r) => r.status === 200,
    'has customerToken':       (r) => !!r.json('customerToken'),
  });

  if (!consentOk) {
    lifecycleErrors.add(1);
    // Clean up
    http.del(`${BASE_URL}/api/v1/sessions/${sessionId}`, null, { headers: AGENT_HEADERS });
    return;
  }

  consentDuration.add(consentRes.timings.duration);
  const customerToken = consentRes.json('customerToken');

  sleep(0.1);

  // 3. Customer uploads initial snapshot
  const snapshot = [fakeMeta(), fakeFullSnapshot(100)];
  const snapshotRes = http.post(
    `${BASE_URL}/api/v1/snapshots/${sessionId}`,
    JSON.stringify({ snapshot, customerToken, url: 'http://example.com/page1' }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'snapshot_upload' } }
  );

  check(snapshotRes, {
    'snapshot stored (201)': (r) => r.status === 201,
  });
  snapshotUploadDuration.add(snapshotRes.timings.duration);

  sleep(0.1);

  // 4. Customer streams DOM events (5 batches of 10 events)
  for (let batch = 0; batch < 5; batch++) {
    const events = fakeIncrementalEvents(10);
    const evtRes = http.post(
      `${BASE_URL}/api/v1/dom-events/${sessionId}`,
      JSON.stringify({ events, customerToken }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'dom_event_post' } }
    );
    check(evtRes, {
      'events buffered (200)': (r) => r.status === 200,
    });
    domEventPostDuration.add(evtRes.timings.duration);
    sleep(0.05);
  }

  // 5. Agent polls for DOM events
  const pollRes = http.get(
    `${BASE_URL}/api/v1/dom-events/${sessionId}?since=0`,
    { headers: AGENT_HEADERS, tags: { name: 'dom_event_poll' } }
  );
  check(pollRes, {
    'poll returns events (200)': (r) => r.status === 200,
    'has events array':          (r) => Array.isArray(r.json('events')),
  });

  // 6. Agent fetches snapshot
  const fetchRes = http.get(
    `${BASE_URL}/api/v1/snapshots/${sessionId}`,
    { headers: AGENT_HEADERS, tags: { name: 'snapshot_fetch' } }
  );
  check(fetchRes, {
    'snapshot fetched (200)': (r) => r.status === 200,
  });

  // 7. Agent ends session
  const endRes = http.del(
    `${BASE_URL}/api/v1/sessions/${sessionId}`,
    null,
    { headers: AGENT_HEADERS, tags: { name: 'end_session' } }
  );
  check(endRes, {
    'session ended (204)': (r) => r.status === 204,
  });
  sessionEndDuration.add(endRes.timings.duration);

  lifecycleErrors.add(0);
  sleep(1);
}
