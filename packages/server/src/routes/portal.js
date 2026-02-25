import config from '../config.js';
import { authenticatePortal, requireAdmin } from '../middleware/portal-auth.js';
import * as vendorAuth from '../services/vendor-auth.js';
import * as vendor from '../services/vendor.js';
import { ValidationError } from '../utils/errors.js';

// ─── Cookie helpers ───────────────────────────────────────────────────────────

function setSessionCookie(reply, sessionId, expiresAt) {
  const secure = !config.isDev ? '; Secure' : '';
  const cookie = `cb_portal_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/${secure}; Expires=${expiresAt.toUTCString()}`;
  reply.header('Set-Cookie', cookie);
}

function clearSessionCookie(reply) {
  const secure = !config.isDev ? '; Secure' : '';
  const cookie = `cb_portal_session=; HttpOnly; SameSite=Strict; Path=/${secure}; Max-Age=0`;
  reply.header('Set-Cookie', cookie);
}

// ─── Auth routes (no preHandler) ──────────────────────────────────────────────

async function portalAuthRoutes(fastify) {

  // POST /api/v1/portal/auth/login
  fastify.post('/auth/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body;
    const result = await vendorAuth.login(email, password, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    setSessionCookie(reply, result.sessionId, result.expiresAt);
    return { user: result.user };
  });

  // POST /api/v1/portal/auth/logout
  fastify.post('/auth/logout', async (request, reply) => {
    // Extract cookie manually (no middleware)
    const header = request.headers.cookie || '';
    const match = header.match(/(?:^|;\s*)cb_portal_session=([^\s;]+)/);
    if (match) {
      await vendorAuth.logout(match[1]);
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  // GET /api/v1/portal/auth/me
  fastify.get('/auth/me', {
    preHandler: authenticatePortal,
  }, async (request) => {
    return { user: request.portalUser };
  });
}

// ─── Tenant routes (all require portal auth) ─────────────────────────────────

async function portalTenantRoutes(fastify) {

  // GET /api/v1/portal/tenants
  fastify.get('/tenants', {
    preHandler: authenticatePortal,
  }, async (request) => {
    const tenants = await vendor.listTenants(request.portalUser.vendorId);
    return { tenants };
  });

  // POST /api/v1/portal/tenants
  fastify.post('/tenants', {
    preHandler: requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:           { type: 'string', minLength: 1, maxLength: 200 },
          allowedDomains: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request, reply) => {
    const actor = {
      userId: request.portalUser.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
    const result = await vendor.createTenant(request.portalUser.vendorId, request.body, actor);
    reply.code(201);
    return result;
  });

  // GET /api/v1/portal/tenants/:id
  fastify.get('/tenants/:id', {
    preHandler: authenticatePortal,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request) => {
    const tenant = await vendor.getTenant(request.portalUser.vendorId, request.params.id);
    return { tenant };
  });

  // PUT /api/v1/portal/tenants/:id
  fastify.put('/tenants/:id', {
    preHandler: requireAdmin,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          name:           { type: 'string', minLength: 1, maxLength: 200 },
          allowedDomains: { type: 'array', items: { type: 'string' } },
          featureFlags:   { type: 'object' },
          isActive:       { type: 'boolean' },
        },
      },
    },
  }, async (request) => {
    const tenant = await vendor.updateTenant(
      request.portalUser.vendorId,
      request.params.id,
      request.body
    );
    return { tenant };
  });

  // POST /api/v1/portal/tenants/:id/rotate-keys
  fastify.post('/tenants/:id/rotate-keys', {
    preHandler: requireAdmin,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request) => {
    const actor = {
      userId: request.portalUser.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
    const { expiresInDays } = request.body || {};
    const expiry = expiresInDays ? parseInt(expiresInDays, 10) : undefined;
    if (expiry !== undefined && (isNaN(expiry) || expiry < 1 || expiry > 3650)) {
      throw new ValidationError('expiresInDays must be between 1 and 3650');
    }
    const result = await vendor.rotateKeys(
      request.portalUser.vendorId,
      request.params.id,
      actor,
      { expiresInDays: expiry }
    );
    return {
      keys: { secretKey: result.secretKey, publicKey: result.publicKey },
      keyExpiresAt: result.keyExpiresAt,
      warning: 'These keys are shown ONCE. Store them securely.',
    };
  });

  // GET /api/v1/portal/tenants/:id/key-events
  fastify.get('/tenants/:id/key-events', {
    preHandler: authenticatePortal,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request) => {
    const events = await vendor.getKeyEvents(request.portalUser.vendorId, request.params.id);
    return { events };
  });

  // GET /api/v1/portal/tenants/:id/auth-failures
  fastify.get('/tenants/:id/auth-failures', {
    preHandler: authenticatePortal,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const limit = request.query.limit ? Math.min(parseInt(request.query.limit, 10), 100) : 50;
    const failures = await vendor.getAuthFailures(
      request.portalUser.vendorId,
      request.params.id,
      { limit }
    );
    return { failures };
  });

  // GET /api/v1/portal/tenants/:id/masking-rules
  fastify.get('/tenants/:id/masking-rules', {
    preHandler: authenticatePortal,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request) => {
    const rules = await vendor.getMaskingRules(request.portalUser.vendorId, request.params.id);
    return { rules };
  });

  // PUT /api/v1/portal/tenants/:id/masking-rules
  fastify.put('/tenants/:id/masking-rules', {
    preHandler: requireAdmin,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        properties: {
          selectors: { type: 'array', items: { type: 'string' } },
          maskTypes: { type: 'array', items: { type: 'string' } },
          patterns:  { type: 'array', items: { type: 'string' } },
        },
      },
    },
  }, async (request) => {
    const rules = await vendor.updateMaskingRules(
      request.portalUser.vendorId,
      request.params.id,
      request.body
    );
    return { rules };
  });

  // GET /api/v1/portal/tenants/:id/sessions
  fastify.get('/tenants/:id/sessions', {
    preHandler: authenticatePortal,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: {
          page:   { type: 'string' },
          limit:  { type: 'string' },
          status: { type: 'string', enum: ['pending', 'active', 'ended'] },
        },
      },
    },
  }, async (request) => {
    const { page, limit, status } = request.query;
    return vendor.listSessions(
      request.portalUser.vendorId,
      request.params.id,
      {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? Math.min(parseInt(limit, 10), 100) : 20,
        status,
      }
    );
  });

  // GET /api/v1/portal/tenants/:id/recordings
  fastify.get('/tenants/:id/recordings', {
    preHandler: authenticatePortal,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: {
          page:   { type: 'string' },
          limit:  { type: 'string' },
          status: { type: 'string', enum: ['recording', 'complete', 'failed'] },
        },
      },
    },
  }, async (request) => {
    const { page, limit, status } = request.query;
    return vendor.listRecordings(
      request.portalUser.vendorId,
      request.params.id,
      {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? Math.min(parseInt(limit, 10), 100) : 20,
        status,
      }
    );
  });

  // GET /api/v1/portal/tenants/:id/recordings/:sessionId
  fastify.get('/tenants/:id/recordings/:sessionId', {
    preHandler: authenticatePortal,
    schema: {
      params: {
        type: 'object',
        properties: {
          id:        { type: 'string', format: 'uuid' },
          sessionId: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request) => {
    return vendor.getRecording(
      request.portalUser.vendorId,
      request.params.id,
      request.params.sessionId
    );
  });

  // GET /api/v1/portal/tenants/:id/analytics
  fastify.get('/tenants/:id/analytics', {
    preHandler: authenticatePortal,
    schema: {
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to:   { type: 'string' },
        },
      },
    },
  }, async (request) => {
    return vendor.getTenantAnalytics(
      request.portalUser.vendorId,
      request.params.id,
      request.query
    );
  });

  // GET /api/v1/portal/analytics/overview
  fastify.get('/analytics/overview', {
    preHandler: authenticatePortal,
  }, async (request) => {
    return vendor.getVendorOverview(request.portalUser.vendorId);
  });
}

export { portalAuthRoutes, portalTenantRoutes };
