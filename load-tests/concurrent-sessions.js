import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Gauge } from 'k6/metrics';
import {
  BASE_URL,
  CUSTOMER_ID,
  AGENT_HEADERS,
} from './config.js';

/**
 * Concurrent Sessions Test
 *
 * Measures how the server handles many sessions being created and
 * consented simultaneously — the "Monday morning rush" scenario.
 *
 * Each VU creates a session, consents, holds it active for a few seconds,
 * then ends it. Ramps to high concurrency to find breaking points.
 *
 * Usage:
 *   k6 run -e SECRET_KEY=cb_sk_... -e PUBLIC_KEY=cb_pk_... load-tests/concurrent-sessions.js
 */

const createLatency  = new Trend('session_create_latency', true);
const consentLatency = new Trend('session_consent_latency', true);
const activeSessions = new Gauge('active_sessions_gauge');

export const options = {
  scenarios: {
    concurrent: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },
        { duration: '30s', target: 25 },
        { duration: '30s', target: 50 },
        { duration: '15s', target: 50 },   // hold peak
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed:           ['rate<0.05'],
    session_create_latency:    ['p(95)<1500'],
    session_consent_latency:   ['p(95)<2000'],
  },
};

export default function () {
  const vu = __VU;
  const iter = __ITER;
  const customerId = `${CUSTOMER_ID}_conc_${vu}_${iter}`;
  const agentId = `agent_conc_${vu}_${iter}`;

  // Create session
  const createRes = http.post(
    `${BASE_URL}/api/v1/sessions`,
    JSON.stringify({ agentId, customerId }),
    { headers: AGENT_HEADERS, tags: { name: 'create_session' } }
  );

  if (!check(createRes, { 'created (201)': (r) => r.status === 201 })) return;
  createLatency.add(createRes.timings.duration);
  const sessionId = createRes.json('sessionId');

  sleep(0.1);

  // Consent
  const consentRes = http.post(
    `${BASE_URL}/consent/${sessionId}/approve`,
    JSON.stringify({ customerId }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'consent' } }
  );

  if (!check(consentRes, { 'consented (200)': (r) => r.status === 200 })) {
    http.del(`${BASE_URL}/api/v1/sessions/${sessionId}`, null, { headers: AGENT_HEADERS });
    return;
  }
  consentLatency.add(consentRes.timings.duration);

  activeSessions.add(1);

  // Hold session active — simulates real co-browse duration
  sleep(3 + Math.random() * 5);

  // End session
  http.del(`${BASE_URL}/api/v1/sessions/${sessionId}`, null, {
    headers: AGENT_HEADERS,
    tags: { name: 'end_session' },
  });

  activeSessions.add(0);
  sleep(0.5);
}
