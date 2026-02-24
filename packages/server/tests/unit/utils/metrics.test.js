import { describe, it, expect, beforeEach } from 'vitest';
import {
  registry,
  httpRequestDuration,
  httpRequestsTotal,
  httpActiveConnections,
  activeSessions,
  sessionLifecycleTotal,
  sessionEndReasonsTotal,
  dbQueryDuration,
  dbQueryErrorsTotal,
  cacheOperationsTotal,
  snapshotSizeBytes,
  resetMetrics,
} from '../../../src/utils/metrics.js';

beforeEach(() => {
  resetMetrics();
});

describe('metrics registry', () => {
  it('uses a custom registry (not the global default)', async () => {
    const { default: client } = await import('prom-client');
    expect(registry).not.toBe(client.register);
  });

  it('returns Prometheus text format from registry.metrics()', async () => {
    httpRequestsTotal.inc({ method: 'GET', route: '/test', status_code: 200 });
    const output = await registry.metrics();
    expect(output).toContain('http_requests_total');
    expect(output).toContain('# HELP');
    expect(output).toContain('# TYPE');
  });
});

describe('HTTP metrics', () => {
  it('httpRequestDuration records observations', async () => {
    httpRequestDuration.observe({ method: 'GET', route: '/api', status_code: 200 }, 0.15);
    const output = await registry.metrics();
    expect(output).toContain('http_request_duration_seconds');
  });

  it('httpRequestsTotal increments', async () => {
    httpRequestsTotal.inc({ method: 'POST', route: '/api/v1/sessions', status_code: 201 });
    httpRequestsTotal.inc({ method: 'POST', route: '/api/v1/sessions', status_code: 201 });
    const output = await registry.metrics();
    expect(output).toMatch(/http_requests_total\{.*method="POST".*\} 2/);
  });

  it('httpActiveConnections gauges up and down', async () => {
    httpActiveConnections.inc();
    httpActiveConnections.inc();
    httpActiveConnections.dec();
    const metric = await httpActiveConnections.get();
    expect(metric.values[0].value).toBe(1);
  });
});

describe('session metrics', () => {
  it('activeSessions tracks pending and active', async () => {
    activeSessions.inc({ status: 'pending' });
    activeSessions.inc({ status: 'active' });
    activeSessions.inc({ status: 'active' });
    const metric = await activeSessions.get();
    const pending = metric.values.find(v => v.labels.status === 'pending');
    const active = metric.values.find(v => v.labels.status === 'active');
    expect(pending.value).toBe(1);
    expect(active.value).toBe(2);
  });

  it('sessionLifecycleTotal tracks events', async () => {
    sessionLifecycleTotal.inc({ event: 'created' });
    sessionLifecycleTotal.inc({ event: 'consented' });
    sessionLifecycleTotal.inc({ event: 'ended' });
    const output = await registry.metrics();
    expect(output).toContain('cobrowse_session_lifecycle_total');
    expect(output).toContain('event="created"');
    expect(output).toContain('event="consented"');
  });

  it('sessionEndReasonsTotal tracks reasons', async () => {
    sessionEndReasonsTotal.inc({ reason: 'agent' });
    sessionEndReasonsTotal.inc({ reason: 'idle_timeout' });
    const output = await registry.metrics();
    expect(output).toContain('cobrowse_session_end_reasons_total');
  });
});

describe('database metrics', () => {
  it('dbQueryDuration records histogram observations', async () => {
    dbQueryDuration.observe(0.005);
    dbQueryDuration.observe(0.123);
    const output = await registry.metrics();
    expect(output).toContain('cobrowse_db_query_duration_seconds');
  });

  it('dbQueryErrorsTotal increments', async () => {
    dbQueryErrorsTotal.inc();
    const metric = await dbQueryErrorsTotal.get();
    expect(metric.values[0].value).toBe(1);
  });
});

describe('cache metrics', () => {
  it('cacheOperationsTotal tracks hit and miss', async () => {
    cacheOperationsTotal.inc({ operation: 'get', result: 'hit' });
    cacheOperationsTotal.inc({ operation: 'get', result: 'miss' });
    cacheOperationsTotal.inc({ operation: 'get', result: 'hit' });
    const output = await registry.metrics();
    expect(output).toMatch(/cobrowse_cache_operations_total\{.*result="hit".*\} 2/);
    expect(output).toMatch(/cobrowse_cache_operations_total\{.*result="miss".*\} 1/);
  });
});

describe('snapshot metrics', () => {
  it('snapshotSizeBytes records observations', async () => {
    snapshotSizeBytes.observe(51200);
    snapshotSizeBytes.observe(1048576);
    const output = await registry.metrics();
    expect(output).toContain('cobrowse_snapshot_size_bytes');
  });
});

describe('resetMetrics', () => {
  it('clears labelled metric values', async () => {
    httpRequestsTotal.inc({ method: 'GET', route: '/', status_code: 200 });
    activeSessions.inc({ status: 'active' });

    resetMetrics();

    const httpMetric = await httpRequestsTotal.get();
    expect(httpMetric.values).toHaveLength(0);

    const sessionMetric = await activeSessions.get();
    expect(sessionMetric.values).toHaveLength(0);
  });

  it('resets label-less counters to zero', async () => {
    dbQueryErrorsTotal.inc();
    dbQueryErrorsTotal.inc();

    resetMetrics();

    const dbMetric = await dbQueryErrorsTotal.get();
    // Label-less counters reset to 0 but still have an entry
    expect(dbMetric.values[0].value).toBe(0);
  });
});
