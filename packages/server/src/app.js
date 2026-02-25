import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import config from './config.js';
import logger from './utils/logger.js';
import * as db from './db/index.js';
import cache from './cache/index.js';
import { AppError } from './utils/errors.js';
import * as metrics from './utils/metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * App factory — creates and configures the Fastify instance.
 *
 * Separating the factory from the server entry point (server.js) allows
 * the app to be imported and tested in isolation without binding to a port.
 */
async function buildApp() {
  const app = Fastify({
    logger: false, // We use our own pino logger
    trustProxy: true,
    ajv: {
      customOptions: {
        // Allow UUID validation via format: 'uuid'
        strict: false,
        coerceTypes: false,
      },
    },
  });

  // ─── Expose db on app instance for routes that need it directly ──────────────
  app.decorate('db', db);

  // ─── Security headers ─────────────────────────────────────────────────────────
  await app.register(fastifyHelmet, {
    // Static assets (SDK, vendor scripts) are intentionally loaded cross-origin
    // by client websites and the demo apps. Allow this explicitly.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    // Generate per-request nonces. The plugin always adds nonces to BOTH
    // script-src and style-src. We strip the style nonce below because when
    // a nonce is present in style-src, browsers ignore 'unsafe-inline' — which
    // breaks rrweb replay and all inline style="" attributes.
    enableCSPNonces: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],                      // nonces auto-added by enableCSPNonces
        styleSrc:   ["'self'", "'unsafe-inline'"],   // inline styles used by rrweb replay + consent page
        connectSrc: ["'self'", '*.ably.io', '*.ably.com', 'realtime.ably.io', 'realtime.ably.com', 'ws:', 'wss:'],
        frameAncestors: ["'self'"],                  // prevent clickjacking via iframes
        formAction: ["'self'"],                      // restrict form submissions
        baseUri: ["'self'"],                         // prevent <base> tag hijacking
        upgradeInsecureRequests: config.isDev ? null : [],  // disable on HTTP localhost, enable in prod
      },
    },
  });

  // Strip the style nonce from the CSP header. @fastify/helmet always injects
  // nonces into both script-src and style-src, but a nonce in style-src causes
  // browsers to ignore 'unsafe-inline', breaking rrweb and inline styles.
  app.addHook('onSend', async (_request, reply, payload) => {
    const csp = reply.getHeader('content-security-policy');
    if (csp) {
      const fixed = csp
        .split(';')
        .map((d) => d.trimStart().startsWith('style-src')
          ? d.replace(/ 'nonce-[A-Za-z0-9+/=]+'/g, '')
          : d)
        .join(';');
      reply.header('content-security-policy', fixed);
    }
    return payload;
  });

  // ─── CORS ─────────────────────────────────────────────────────────────────────
  // In production, restrict origins to tenant-registered domains.
  // For MVP, we allow the configured origins plus localhost for demos.
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (server-to-server, Postman, same-origin fetches)
      if (!origin) return cb(null, true);

      // When CORS_ALLOW_ALL=true (set this on Railway/Render for the demo), allow any origin.
      // The demo serves its own apps from the same origin, so this is only hit by
      // external integrations (e.g. a customer's real website embedding the SDK).
      if (process.env.CORS_ALLOW_ALL === 'true') return cb(null, true);

      const allowed = [
        ...config.cors.extraOrigins,
        'http://localhost:3001',
        'http://localhost:3002',
        'http://localhost:4000',
        'http://localhost:5173',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:3002',
        'http://127.0.0.1:4000',
        'http://127.0.0.1:5173',
      ];

      if (allowed.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed`), false);
    },
    methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-CB-Secret-Key',
      'X-CB-Public-Key',
      'X-Customer-Token',
    ],
    credentials: true,
  });

  // ─── Rate limiting ─────────────────────────────────────────────────────────────
  await app.register(fastifyRateLimit, {
    global:   true,
    max:      500,           // per IP per minute — high enough for HTTP relay polling
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      // Rate limit per tenant when available, otherwise per IP
      const tenantId = request.tenant?.id;
      return tenantId ? `${tenantId}:${request.ip}` : request.ip;
    },
    errorResponseBuilder: () => ({
      error:   'Too Many Requests',
      message: 'Rate limit exceeded. Please slow down.',
    }),
  });

  // ─── Static files (SDK bundle + vendor) ──────────────────────────────────────
  await app.register(fastifyStatic, {
    root:   path.join(__dirname, '../public'),
    prefix: '/static/',
  });

  // ─── Demo apps — served from public/demo/ ────────────────────────────────────
  // Both demo apps live at:
  //   /demo/customer/  →  the customer claim-form page
  //   /demo/agent/     →  the agent co-browse console
  //
  // Demo files (index.html, styles.css, app.js) are in packages/server/public/demo/.
  // This ensures they work both locally and on Railway (where Nixpacks only
  // includes the server workspace, pruning sibling packages).
  await app.register(fastifyStatic, {
    root:           path.join(__dirname, '../public/demo/customer'),
    prefix:         '/demo/customer/',
    decorateReply:  false,
  });

  await app.register(fastifyStatic, {
    root:           path.join(__dirname, '../public/demo/agent'),
    prefix:         '/demo/agent/',
    decorateReply:  false,
  });

  // ─── Demo config injection ─────────────────────────────────────────────────────
  // Returns a JS snippet that sets window.COBROWSE_DEMO_CONFIG with keys from env.
  // Both demo app index.html files load this before their own app.js.
  // Set DEMO_SECRET_KEY and DEMO_PUBLIC_KEY in your hosting provider after first deploy.
  app.get('/demo/config.js', async (request, reply) => {
    reply.header('Content-Type', 'application/javascript; charset=utf-8');
    reply.header('Cache-Control', 'no-store');
    // JSON.stringify safely escapes special characters to prevent XSS via env vars
    const demoConfig = {
      serverUrl: null, // set from window.location.origin in client
      publicKey: process.env.DEMO_PUBLIC_KEY || '',
      secretKey: process.env.DEMO_SECRET_KEY || '',
      customerId: 'cust_demo_001',
    };
    return `window.COBROWSE_DEMO_CONFIG = ${JSON.stringify(demoConfig)};
window.COBROWSE_DEMO_CONFIG.serverUrl = window.location.origin;
`;
  });

  // ─── Demo landing page ────────────────────────────────────────────────────────
  app.get('/demo', async (request, reply) => {
    const configured = !!(process.env.DEMO_PUBLIC_KEY && process.env.DEMO_SECRET_KEY);
    const notice = configured
      ? `<div class="note ok">✅ Demo is configured and ready.</div>`
      : `<div class="note warn">
           ⚠️ <strong>Setup required.</strong>
           Deploy first, then copy <code>DEMO_SECRET_KEY</code> and <code>DEMO_PUBLIC_KEY</code>
           from the build log into your Railway / Render env vars and redeploy.
         </div>`;
    reply.type('text/html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CoBrowse — Demo</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:80px auto;padding:0 24px;color:#1a1a2e}
    h1{font-size:28px;margin-bottom:8px}p{color:#555;line-height:1.6}
    .links{display:flex;gap:16px;margin-top:32px;flex-wrap:wrap}
    a.btn{display:inline-block;padding:16px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px}
    .agent{background:#4f6ef7;color:#fff}
    .customer{background:#f0f4ff;color:#4f6ef7;border:2px solid #c7d4ff}
    .note{margin-top:28px;padding:14px 18px;border-radius:8px;font-size:14px;line-height:1.5}
    .note.ok{background:#f0fff4;border:1px solid #68d391;color:#276749}
    .note.warn{background:#fffbeb;border:1px solid #f6c843;color:#92611c}
    code{background:#f3f4f6;padding:2px 6px;border-radius:4px}
    .steps{margin-top:28px;font-size:14px;color:#666;line-height:1.8}
  </style>
</head>
<body>
  <h1>🔍 CoBrowse Demo</h1>
  <p>Open the <strong>Agent Console</strong> and <strong>Customer Page</strong> side by side.
     Start a co-browse session from the agent side to see live DOM mirroring in action.</p>
  <div class="links">
    <a class="btn agent"    href="/demo/agent/"    target="_blank">🧑‍💼 Agent Console →</a>
    <a class="btn customer" href="/demo/customer/" target="_blank">👤 Customer Page →</a>
  </div>
  ${notice}
  <div class="steps">
    <strong>Demo flow:</strong><br>
    1. Click <em>Start Co-Browse</em> in the Agent Console<br>
    2. Click the invite link shown — it opens the Customer Page automatically<br>
    3. Customer clicks <em>Allow</em> in the consent overlay<br>
    4. Agent sees the customer's form in real time
  </div>
</body>
</html>`);
  });

  // ─── Prometheus metrics ──────────────────────────────────────────────────────
  await app.register(metrics.metricsPlugin);

  // ─── Request logging + metrics ─────────────────────────────────────────────
  app.addHook('onRequest', async (request) => {
    request.startTime = process.hrtime.bigint();
    metrics.httpActiveConnections.inc();
    logger.info(
      { method: request.method, url: request.url, ip: request.ip },
      'incoming request'
    );
  });

  app.addHook('onResponse', async (request, reply) => {
    metrics.httpActiveConnections.dec();
    const route = request.routeOptions?.url || request.url;
    const labels = {
      method: request.method,
      route,
      status_code: reply.statusCode,
    };
    if (request.startTime) {
      const duration = Number(process.hrtime.bigint() - request.startTime) / 1e9;
      metrics.httpRequestDuration.observe(labels, duration);
    }
    metrics.httpRequestsTotal.inc(labels);
    logger.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode },
      'request handled'
    );
  });

  // ─── Global error handler ─────────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      // Log security-relevant errors (auth failures, forbidden access)
      if (error.statusCode === 401 || error.statusCode === 403) {
        logger.warn(
          { code: error.code, ip: request.ip, method: request.method, url: request.url },
          'security: auth/authz failure'
        );
      }
      reply.code(error.statusCode).send({
        error:   error.code,
        message: error.message,
      });
      return;
    }

    // Fastify validation errors
    if (error.validation) {
      reply.code(400).send({
        error:   'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: error.validation,
      });
      return;
    }

    logger.error({ err: error, url: request.url }, 'unhandled error');
    reply.code(500).send({
      error:   'INTERNAL_ERROR',
      message: config.isDev ? error.message : 'An internal error occurred',
    });
  });

  // ─── Routes ───────────────────────────────────────────────────────────────────
  // Liveness probe — always returns 200 if the process is up (load balancers, k8s)
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // Readiness probe — checks DB and cache connectivity before accepting traffic
  app.get('/health/ready', async (_request, reply) => {
    const checks = {};
    let healthy = true;

    // PostgreSQL
    try {
      await db.query('SELECT 1');
      checks.db = 'ok';
    } catch (err) {
      checks.db = 'error';
      healthy = false;
      logger.warn({ err }, 'readiness: db check failed');
    }

    // Cache (Redis when CACHE_DRIVER=redis, always ok for in-memory)
    if (typeof cache.ping === 'function') {
      checks.cache = (await cache.ping()) ? 'ok' : 'error';
      if (checks.cache !== 'ok') healthy = false;
    } else {
      checks.cache = 'ok'; // in-memory is always available
    }

    const status = healthy ? 'ok' : 'degraded';
    reply.code(healthy ? 200 : 503).send({ status, checks, ts: new Date().toISOString() });
  });

  // API v1 — agent-facing
  const sessionsRoutes = (await import('./routes/sessions.js')).default;
  const snapshotsRoutes = (await import('./routes/snapshots.js')).default;
  const domEventsRoutes = (await import('./routes/dom-events.js')).default;
  const ablyAuthRoutes = (await import('./routes/ably-auth.js')).default;

  const recordingsRoutes = (await import('./routes/recordings.js')).default;

  app.register(sessionsRoutes,    { prefix: '/api/v1/sessions' });
  app.register(snapshotsRoutes,   { prefix: '/api/v1/snapshots' });
  app.register(domEventsRoutes,   { prefix: '/api/v1/dom-events' });
  app.register(ablyAuthRoutes,    { prefix: '/api/v1/ably-auth' });
  app.register(recordingsRoutes,  { prefix: '/api/v1/recordings' });

  // API v1 — admin
  const { adminRoutes, publicRoutes } = await import('./routes/admin.js');
  app.register(adminRoutes,  { prefix: '/api/v1/admin' });
  app.register(publicRoutes, { prefix: '/api/v1/public' });

  // Consent page — customer-facing HTML
  const consentRoutes = (await import('./routes/consent.js')).default;
  app.register(consentRoutes, { prefix: '/consent' });

  // Embed viewer — iframe-friendly session viewer for vendor integration (JWT auth)
  const embedRoutes = (await import('./routes/embed.js')).default;
  app.register(embedRoutes, { prefix: '/embed' });

  // ─── Vendor Management Portal ───────────────────────────────────────────────
  const { portalAuthRoutes, portalTenantRoutes } = await import('./routes/portal.js');
  app.register(portalAuthRoutes,   { prefix: '/api/v1/portal' });
  app.register(portalTenantRoutes, { prefix: '/api/v1/portal' });

  // Serve the tenant-ui SPA from /portal/
  await app.register(fastifyStatic, {
    root:          path.join(__dirname, '../public/tenant-ui'),
    prefix:        '/portal/',
    decorateReply: false,
    wildcard:      false,
  });

  // Root → redirect to portal (SPA handles auth check)
  app.get('/', async (request, reply) => {
    return reply.redirect('/portal/');
  });

  // /portal (no trailing slash) → redirect to /portal/
  app.get('/portal', async (request, reply) => {
    return reply.redirect('/portal/');
  });

  // SPA fallback — serve static assets from subdirectories (e.g. /portal/assets/*)
  // or fall back to index.html for client-side routes.
  // Note: reply.sendFile() uses the first @fastify/static root regardless of the
  // root arg, so we read files directly with correct MIME types.
  const tenantUiRoot = path.join(__dirname, '../public/tenant-ui');
  const MIME_TYPES = {
    '.js': 'application/javascript', '.mjs': 'application/javascript',
    '.css': 'text/css', '.html': 'text/html',
    '.json': 'application/json', '.map': 'application/json',
    '.svg': 'image/svg+xml', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon', '.webp': 'image/webp',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
    '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
  };

  async function serveFile(reply, filePath, mimeType) {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(tenantUiRoot)) {
      reply.code(403);
      return { error: 'Forbidden' };
    }
    try {
      await fs.access(resolved);
    } catch {
      reply.code(404);
      return { error: 'Not found' };
    }
    reply.type(mimeType);
    return createReadStream(resolved);
  }

  app.get('/portal/*', async (request, reply) => {
    const urlPath = request.params['*'];
    const ext = path.extname(urlPath);
    if (ext && MIME_TYPES[ext]) {
      return serveFile(reply, path.join(tenantUiRoot, urlPath), MIME_TYPES[ext]);
    }
    // Client-side route — serve the SPA shell
    return serveFile(reply, path.join(tenantUiRoot, 'index.html'), 'text/html');
  });

  return app;
}

export default buildApp;
