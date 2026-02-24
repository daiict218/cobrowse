import http from 'k6/http';
import { check, sleep } from 'k6';
import { DEFAULT_THRESHOLDS, BASE_URL } from './config.js';

/**
 * Health Endpoint Smoke Test
 *
 * Quick baseline test — hits /health and /health/ready under moderate load.
 * Use this to validate the server is responsive before running heavier tests.
 *
 * Usage:
 *   k6 run load-tests/health-smoke.js
 *   k6 run -e BASE_URL=https://your-server.com load-tests/health-smoke.js
 */

export const options = {
  scenarios: {
    health: {
      executor: 'constant-arrival-rate',
      rate: 50,             // 50 requests/sec
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 10,
      maxVUs: 20,
    },
  },
  thresholds: {
    ...DEFAULT_THRESHOLDS,
    http_req_duration: ['p(95)<200', 'p(99)<500'],  // health should be fast
  },
};

export default function () {
  // Liveness
  const healthRes = http.get(`${BASE_URL}/health`, {
    tags: { name: 'health_liveness' },
  });
  check(healthRes, {
    'health returns 200':       (r) => r.status === 200,
    'health status is ok':      (r) => r.json('status') === 'ok',
  });

  // Readiness (includes DB + cache check)
  const readyRes = http.get(`${BASE_URL}/health/ready`, {
    tags: { name: 'health_readiness' },
  });
  check(readyRes, {
    'ready returns 200':        (r) => r.status === 200,
    'ready db is ok':           (r) => r.json('checks.db') === 'ok',
    'ready cache is ok':        (r) => r.json('checks.cache') === 'ok',
  });
}
