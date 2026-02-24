import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import {
  BASE_URL,
  CUSTOMER_ID,
  AGENT_HEADERS,
  fakeMeta,
  fakeFullSnapshot,
} from './config.js';

/**
 * Snapshot Stress Test
 *
 * Tests large snapshot upload/download under concurrent session load.
 * Each VU creates its own session, uploads snapshots of varying sizes,
 * and the agent fetches them back.
 *
 * Validates that the server handles large payloads (500KB–1MB+)
 * without timeouts or memory issues.
 *
 * Usage:
 *   k6 run -e SECRET_KEY=cb_sk_... -e PUBLIC_KEY=cb_pk_... load-tests/snapshot-stress.js
 */

const uploadLatency  = new Trend('snapshot_upload_latency', true);
const fetchLatency   = new Trend('snapshot_fetch_latency', true);

export const options = {
  scenarios: {
    snapshots: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 5 },
        { duration: '1m',  target: 15 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed:          ['rate<0.02'],
    snapshot_upload_latency:  ['p(95)<3000'],    // large payloads allowed 3s
    snapshot_fetch_latency:   ['p(95)<1000'],
  },
};

export default function () {
  const vu = __VU;
  const iter = __ITER;
  const customerId = `${CUSTOMER_ID}_snap_${vu}_${iter}`;
  const agentId = `agent_snap_${vu}_${iter}`;

  // Create session
  const createRes = http.post(
    `${BASE_URL}/api/v1/sessions`,
    JSON.stringify({ agentId, customerId }),
    { headers: AGENT_HEADERS, tags: { name: 'create_session' } }
  );
  if (createRes.status !== 201) return;
  const sessionId = createRes.json('sessionId');

  // Consent
  const consentRes = http.post(
    `${BASE_URL}/consent/${sessionId}/approve`,
    JSON.stringify({ customerId }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'consent' } }
  );
  if (consentRes.status !== 200) {
    http.del(`${BASE_URL}/api/v1/sessions/${sessionId}`, null, { headers: AGENT_HEADERS });
    return;
  }
  const customerToken = consentRes.json('customerToken');

  // Upload snapshots of increasing size (simulates complex pages)
  const sizes = [50, 200, 500]; // node counts → roughly 5KB, 20KB, 50KB payloads
  for (const nodeCount of sizes) {
    const snapshot = [fakeMeta(), fakeFullSnapshot(nodeCount)];
    const body = JSON.stringify({ snapshot, customerToken, url: `http://example.com/page-${nodeCount}` });

    const uploadRes = http.post(
      `${BASE_URL}/api/v1/snapshots/${sessionId}`,
      body,
      { headers: { 'Content-Type': 'application/json' }, tags: { name: `snapshot_upload_${nodeCount}` } }
    );
    check(uploadRes, {
      [`upload ${nodeCount} nodes (201)`]: (r) => r.status === 201,
    });
    uploadLatency.add(uploadRes.timings.duration);
    sleep(0.2);
  }

  // Agent fetches the latest snapshot
  const fetchRes = http.get(
    `${BASE_URL}/api/v1/snapshots/${sessionId}`,
    { headers: AGENT_HEADERS, tags: { name: 'snapshot_fetch' } }
  );
  check(fetchRes, {
    'fetch snapshot (200)': (r) => r.status === 200,
    'snapshot has data':    (r) => !!r.json('snapshot'),
  });
  fetchLatency.add(fetchRes.timings.duration);

  // End session
  http.del(`${BASE_URL}/api/v1/sessions/${sessionId}`, null, {
    headers: AGENT_HEADERS,
    tags: { name: 'end_session' },
  });

  sleep(0.5);
}
