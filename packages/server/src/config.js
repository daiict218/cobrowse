import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the server package root, regardless of where the process was launched from
// __dirname = packages/server/src → ../ = packages/server/ → .env lives there
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key, defaultValue) {
  return process.env[key] ?? defaultValue;
}

const config = {
  env: optionalEnv('NODE_ENV', 'development'),
  isDev: optionalEnv('NODE_ENV', 'development') === 'development',

  server: {
    port: parseInt(optionalEnv('PORT', '3000'), 10),
    host: optionalEnv('HOST', '0.0.0.0'),
  },

  db: {
    url: requireEnv('DATABASE_URL'),
    // Enable SSL by default in production; override with DB_SSL=false for
    // Docker/self-hosted Postgres that doesn't support SSL.
    ssl: optionalEnv('DB_SSL', optionalEnv('NODE_ENV') === 'production' ? 'true' : 'false') === 'true'
      ? { rejectUnauthorized: false }
      : false,
  },

  cache: {
    // "memory" (development/demo) or "redis" (production)
    driver: optionalEnv('CACHE_DRIVER', 'memory'),
    redisUrl: optionalEnv('REDIS_URL', 'redis://localhost:6379'),
  },

  ably: {
    // Full API key for server-side token generation and publishing
    apiKey: requireEnv('ABLY_API_KEY'),
  },

  security: {
    // Signs customer session reconnect tokens
    tokenSecret: requireEnv('TOKEN_SECRET'),
  },

  session: {
    maxDurationMinutes: parseInt(
      optionalEnv('SESSION_MAX_DURATION_MINUTES', '120'),
      10
    ),
    idleTimeoutMinutes: parseInt(
      optionalEnv('SESSION_IDLE_TIMEOUT_MINUTES', '10'),
      10
    ),
    snapshotTtlSeconds: parseInt(
      optionalEnv('SNAPSHOT_TTL_SECONDS', '7200'),
      10
    ),
  },

  cors: {
    // Additional allowed origins beyond tenant-registered domains
    extraOrigins: optionalEnv('ALLOWED_ORIGINS', '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },

  logging: {
    level: optionalEnv('LOG_LEVEL', 'info'),
  },

  metrics: {
    enabled: optionalEnv('METRICS_ENABLED', 'true') === 'true',
  },
};

export default config;
