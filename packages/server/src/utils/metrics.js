import client from 'prom-client';
import config from '../config.js';

// Custom registry — avoids global registry state leakage between test files
const registry = new client.Registry();

// ─── HTTP metrics ────────────────────────────────────────────────────────────

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

const httpActiveConnections = new client.Gauge({
  name: 'http_active_connections',
  help: 'Number of in-flight HTTP requests',
  registers: [registry],
});

// ─── Session metrics ─────────────────────────────────────────────────────────

const activeSessions = new client.Gauge({
  name: 'cobrowse_active_sessions',
  help: 'Number of active co-browse sessions by status',
  labelNames: ['status'],
  registers: [registry],
});

const sessionLifecycleTotal = new client.Counter({
  name: 'cobrowse_session_lifecycle_total',
  help: 'Session lifecycle event counts',
  labelNames: ['event'],
  registers: [registry],
});

const sessionEndReasonsTotal = new client.Counter({
  name: 'cobrowse_session_end_reasons_total',
  help: 'Session end reason counts',
  labelNames: ['reason'],
  registers: [registry],
});

// ─── Database metrics ────────────────────────────────────────────────────────

const dbQueryDuration = new client.Histogram({
  name: 'cobrowse_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

const dbQueryErrorsTotal = new client.Counter({
  name: 'cobrowse_db_query_errors_total',
  help: 'Total database query errors',
  registers: [registry],
});

// ─── Cache metrics ───────────────────────────────────────────────────────────

const cacheOperationsTotal = new client.Counter({
  name: 'cobrowse_cache_operations_total',
  help: 'Cache operation counts by operation and result',
  labelNames: ['operation', 'result'],
  registers: [registry],
});

// ─── Recording metrics ──────────────────────────────────────────────────

const recordingEventsTotal = new client.Counter({
  name: 'cobrowse_recording_events_total',
  help: 'Total rrweb events buffered for recording',
  registers: [registry],
});

const recordingSizeBytes = new client.Histogram({
  name: 'cobrowse_recording_size_bytes',
  help: 'Compressed recording file size in bytes',
  buckets: [1024, 10240, 51200, 102400, 524288, 1048576, 5242880, 10485760],
  registers: [registry],
});

// ─── Auth metrics ───────────────────────────────────────────────────────────

const authFailuresTotal = new client.Counter({
  name: 'cobrowse_auth_failures_total',
  help: 'Total authentication failures by type and reason',
  labelNames: ['auth_type', 'reason'],
  registers: [registry],
});

// ─── Snapshot metrics ────────────────────────────────────────────────────────

const snapshotSizeBytes = new client.Histogram({
  name: 'cobrowse_snapshot_size_bytes',
  help: 'DOM snapshot size in bytes',
  buckets: [1024, 10240, 51200, 102400, 262144, 524288, 1048576, 2097152],
  registers: [registry],
});

// ─── Fastify plugin ──────────────────────────────────────────────────────────

async function metricsPlugin(fastify) {
  if (!config.metrics.enabled) return;

  client.collectDefaultMetrics({ register: registry });

  fastify.get('/metrics', {
    config: { rateLimit: false },
    logLevel: 'warn',
  }, async (request, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });
}

// ─── Test helper ─────────────────────────────────────────────────────────────

function resetMetrics() {
  registry.resetMetrics();
}

export {
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
  authFailuresTotal,
  snapshotSizeBytes,
  recordingEventsTotal,
  recordingSizeBytes,
  metricsPlugin,
  resetMetrics,
};
