# Load Tests (k6)

Performance and stress tests for the CoBrowse session server.

## Prerequisites

Install [k6](https://k6.io/docs/get-started/installation/):

```bash
# macOS
brew install k6

# Docker (no install needed)
docker run --rm -i grafana/k6 run - <load-tests/health-smoke.js
```

## Environment Variables

All tests accept these via `-e`:

| Variable      | Required | Default                  | Description                    |
|---------------|----------|--------------------------|--------------------------------|
| `BASE_URL`    | No       | `http://localhost:4000`  | Server base URL                |
| `SECRET_KEY`  | Yes*     | —                        | Tenant secret key (`cb_sk_…`)  |
| `PUBLIC_KEY`  | Yes*     | —                        | Tenant public key (`cb_pk_…`)  |
| `CUSTOMER_ID` | No       | `cust_load_test`         | Base customer ID prefix        |

*Not needed for `health-smoke.js`.

## Test Scenarios

### 1. Health Smoke (`health-smoke.js`)

Quick baseline — 50 req/s for 30s against `/health` and `/health/ready`.

```bash
k6 run load-tests/health-smoke.js
```

**Thresholds**: P95 < 200ms, P99 < 500ms, <1% errors.

### 2. Session Lifecycle (`session-lifecycle.js`)

Full co-browse flow per VU: create → consent → snapshot → DOM events → end.
Ramps from 1 to 20 concurrent users over 2.5 minutes.

```bash
k6 run \
  -e SECRET_KEY=cb_sk_... \
  -e PUBLIC_KEY=cb_pk_... \
  load-tests/session-lifecycle.js
```

**Thresholds**: Session create P95 < 1s, consent P95 < 1.5s, DOM event POST P95 < 500ms.

### 3. DOM Events Throughput (`dom-events-throughput.js`)

Stress-tests the HTTP relay hot path. 10 VUs POST events + 5 VUs poll
simultaneously on a single shared session for 2 minutes.

```bash
k6 run \
  -e SECRET_KEY=cb_sk_... \
  -e PUBLIC_KEY=cb_pk_... \
  load-tests/dom-events-throughput.js
```

**Thresholds**: POST P95 < 300ms, poll P95 < 300ms, <1% errors.

### 4. Snapshot Stress (`snapshot-stress.js`)

Tests large snapshot upload/download (50–500 DOM nodes per snapshot)
with 15 concurrent sessions.

```bash
k6 run \
  -e SECRET_KEY=cb_sk_... \
  -e PUBLIC_KEY=cb_pk_... \
  load-tests/snapshot-stress.js
```

**Thresholds**: Upload P95 < 3s, fetch P95 < 1s.

### 5. Concurrent Sessions (`concurrent-sessions.js`)

"Monday morning rush" — ramps to 50 simultaneous sessions being created,
consented, held active, and ended.

```bash
k6 run \
  -e SECRET_KEY=cb_sk_... \
  -e PUBLIC_KEY=cb_pk_... \
  load-tests/concurrent-sessions.js
```

**Thresholds**: Create P95 < 1.5s, consent P95 < 2s.

## Running Against Railway/Production

```bash
k6 run \
  -e BASE_URL=https://cobrowse-server-production.up.railway.app \
  -e SECRET_KEY=cb_sk_... \
  -e PUBLIC_KEY=cb_pk_... \
  load-tests/session-lifecycle.js
```

## Viewing Results with Prometheus + Grafana

If Prometheus and Grafana are running (`docker-compose up -d prometheus grafana`),
k6 can export metrics in real time:

```bash
K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write \
  k6 run -o experimental-prometheus-rw load-tests/session-lifecycle.js
```

Then query `k6_*` metrics in Grafana alongside the server's own `cobrowse_*` metrics.
