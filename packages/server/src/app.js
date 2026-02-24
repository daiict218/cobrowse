'use strict';

const path = require('path');
const Fastify = require('fastify');
const fs = require('fs');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./db');
const { AppError } = require('./utils/errors');

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
  await app.register(require('@fastify/helmet'), {
    // Static assets (SDK, vendor scripts) are intentionally loaded cross-origin
    // by client websites and the demo apps. Allow this explicitly.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'", "'unsafe-inline'"],  // consent page needs inline script
        styleSrc:   ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", '*.ably.io', '*.ably.com', 'realtime.ably.io', 'realtime.ably.com', 'ws:', 'wss:'],
      },
    },
  });

  // ─── CORS ─────────────────────────────────────────────────────────────────────
  // In production, restrict origins to tenant-registered domains.
  // For MVP, we allow the configured origins plus localhost for demos.
  await app.register(require('@fastify/cors'), {
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
        'http://127.0.0.1:3001',
        'http://127.0.0.1:3002',
        'http://127.0.0.1:4000',
      ];

      if (allowed.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed`), false);
    },
    methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'X-API-Key',
      'X-CB-Secret-Key',
      'X-CB-Public-Key',
      'X-Customer-Token',
    ],
    credentials: true,
  });

  // ─── Rate limiting ─────────────────────────────────────────────────────────────
  await app.register(require('@fastify/rate-limit'), {
    global:   true,
    max:      200,
    timeWindow: '1 minute',
    // Higher limit for the Ably auth endpoint (SDK polls this on reconnect)
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => ({
      error:   'Too Many Requests',
      message: 'Rate limit exceeded. Please slow down.',
    }),
  });

  // ─── Static files (SDK bundle + vendor) ──────────────────────────────────────
  await app.register(require('@fastify/static'), {
    root:   path.join(__dirname, '../public'),
    prefix: '/static/',
  });

  // ─── Demo apps — served directly from source for easy hosting ────────────────
  // When deployed (e.g. Railway), both demo apps live at:
  //   /demo/customer/  →  the customer claim-form page
  //   /demo/agent/     →  the agent co-browse console
  // Static assets (styles.css, app.js) are served by these mounts.
  // The index.html files reference /static/... which resolves to the SDK/vendor files.
  await app.register(require('@fastify/static'), {
    root:           path.join(__dirname, '../../customer-app'),
    prefix:         '/demo/customer/',
    decorateReply:  false,
  });

  await app.register(require('@fastify/static'), {
    root:           path.join(__dirname, '../../agent-app'),
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
    return `window.COBROWSE_DEMO_CONFIG = {
  serverUrl:  window.location.origin,
  publicKey:  '${process.env.DEMO_PUBLIC_KEY  || ''}',
  secretKey:  '${process.env.DEMO_SECRET_KEY  || ''}',
  customerId: 'cust_demo_001',
};
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

  // ─── Request logging ──────────────────────────────────────────────────────────
  app.addHook('onRequest', async (request) => {
    logger.info(
      { method: request.method, url: request.url, ip: request.ip },
      'incoming request'
    );
  });

  app.addHook('onResponse', async (request, reply) => {
    logger.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode },
      'request handled'
    );
  });

  // ─── Global error handler ─────────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
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
  // Health check (no auth — used by load balancers)
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // API v1 — agent-facing
  app.register(require('./routes/sessions'),  { prefix: '/api/v1/sessions' });
  app.register(require('./routes/snapshots'), { prefix: '/api/v1/snapshots' });
  app.register(require('./routes/ably-auth'), { prefix: '/api/v1/ably-auth' });

  // API v1 — admin
  const { adminRoutes, publicRoutes } = require('./routes/admin');
  app.register(adminRoutes,  { prefix: '/api/v1/admin' });
  app.register(publicRoutes, { prefix: '/api/v1/public' });

  // Consent page — customer-facing HTML
  app.register(require('./routes/consent'), { prefix: '/consent' });

  return app;
}

module.exports = buildApp;
