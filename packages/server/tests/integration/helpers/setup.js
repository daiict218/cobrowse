/**
 * Integration test helper — DB setup, test tenant, app builder.
 *
 * Uses the real PostgreSQL database (same one as docker-compose).
 * Each test file should call cleanup() in afterEach to truncate tables.
 */
import { vi } from 'vitest';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashApiKey } from '../../../src/utils/token.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Test credentials ────────────────────────────────────────────────────────
const TEST_SECRET_KEY = 'cb_sk_test_secret_key_for_integration_tests';
const TEST_PUBLIC_KEY = 'cb_pk_test_public_key_for_integration_tests';
const TEST_TENANT_NAME = 'Test Tenant';

let pool;
let testTenantId;

/**
 * Initialize the test database: run schema, seed test tenant.
 * Call once in beforeAll.
 */
async function setupDatabase() {
  const dbUrl = process.env.DATABASE_URL || 'postgresql://cobrowse:cobrowse_dev@localhost:5432/cobrowse';

  pool = new pg.Pool({
    connectionString: dbUrl,
    max: 5,
  });

  // Run schema
  const schemaPath = path.join(__dirname, '../../../src/db/schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);

  // Clean existing test data
  await cleanup();

  // Seed test tenant (upsert to handle parallel test files sharing the DB)
  const secretHash = hashApiKey(TEST_SECRET_KEY);
  const publicHash = hashApiKey(TEST_PUBLIC_KEY);

  const result = await pool.query(
    `INSERT INTO tenants (name, secret_key_hash, public_key_hash, allowed_domains, masking_rules, feature_flags)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (secret_key_hash) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [
      TEST_TENANT_NAME,
      secretHash,
      publicHash,
      ['localhost', 'example.com'],
      JSON.stringify({ selectors: [], maskTypes: ['password', 'tel'], patterns: [] }),
      JSON.stringify({ agentControl: false, sessionReplay: false, nativeSDK: false }),
    ]
  );

  testTenantId = result.rows[0].id;
}

/**
 * Truncate session data (keep tenant for reuse).
 */
async function cleanup() {
  if (!pool) return;
  await pool.query('DELETE FROM session_events');
  await pool.query('DELETE FROM sessions');
}

/**
 * Full teardown — remove tenant too and close pool.
 */
async function teardown() {
  if (!pool) return;
  await pool.query('DELETE FROM session_events');
  await pool.query('DELETE FROM sessions');
  await pool.query('DELETE FROM tenants WHERE name = $1', [TEST_TENANT_NAME]);
  await pool.end();
}

function getPool() {
  return pool;
}

function getTestTenantId() {
  return testTenantId;
}

function getTestKeys() {
  return { secretKey: TEST_SECRET_KEY, publicKey: TEST_PUBLIC_KEY };
}

/**
 * Build a Fastify app instance configured for testing.
 * Mocks Ably to avoid real API calls.
 */
async function getTestApp() {
  // Mock Ably before importing buildApp
  vi.doMock('ably', () => ({
    default: {
      Rest: class {
        constructor() {
          this.auth = {
            createTokenRequest: vi.fn().mockResolvedValue({
              keyName: 'test',
              timestamp: Date.now(),
              nonce: 'testnonce',
              capability: '{}',
            }),
          };
          this.channels = {
            get: () => ({
              publish: vi.fn().mockResolvedValue(undefined),
            }),
          };
        }
      },
    },
    Rest: class {
      constructor() {
        this.auth = {
          createTokenRequest: vi.fn().mockResolvedValue({
            keyName: 'test',
            timestamp: Date.now(),
            nonce: 'testnonce',
            capability: '{}',
          }),
        };
        this.channels = {
          get: () => ({
            publish: vi.fn().mockResolvedValue(undefined),
          }),
        };
      }
    },
  }));

  const { default: buildApp } = await import('../../../src/app.js');
  const app = await buildApp();
  return app;
}

/**
 * Create a session directly in the DB (bypasses service logic).
 * Useful for setting up test fixtures.
 */
async function createTestSession(overrides = {}) {
  const defaults = {
    tenant_id: testTenantId,
    agent_id: 'agent_test_001',
    customer_id: 'cust_test_001',
    status: 'pending',
    channel_ref: null,
  };
  const opts = { ...defaults, ...overrides };

  const result = await pool.query(
    `INSERT INTO sessions (tenant_id, agent_id, customer_id, status, channel_ref, invite_sent_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [opts.tenant_id, opts.agent_id, opts.customer_id, opts.status, opts.channel_ref]
  );

  return result.rows[0];
}

export {
  setupDatabase,
  cleanup,
  teardown,
  getPool,
  getTestTenantId,
  getTestKeys,
  getTestApp,
  createTestSession,
};
