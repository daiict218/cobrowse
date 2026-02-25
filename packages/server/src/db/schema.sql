-- CoBrowse Platform — PostgreSQL Schema
-- Run via: npm run db:migrate
-- All tables include tenant_id for strict multi-tenant isolation.

-- ─── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- ─── Tenants ───────────────────────────────────────────────────────────────────
-- Each tenant is a company that has licensed the co-browse platform.
-- One tenant = one Sprinklr instance, one Zendesk account, etc.
CREATE TABLE IF NOT EXISTS tenants (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,

  -- API keys are stored as SHA-256 hashes. Raw keys are shown once at creation.
  secret_key_hash   TEXT        NOT NULL UNIQUE,
  public_key_hash   TEXT        NOT NULL UNIQUE,

  -- Domains that are allowed to embed the SDK and call the API.
  -- Enforced at CORS and Ably token capability level.
  allowed_domains   TEXT[]      NOT NULL DEFAULT '{}',

  -- Configurable masking rules for this tenant's websites.
  -- Schema: { selectors: string[], maskTypes: string[], patterns: string[] }
  masking_rules     JSONB       NOT NULL DEFAULT '{"selectors":[],"maskTypes":["password","tel"],"patterns":[]}',

  -- Feature flags gate Phase 2 / Phase 3 capabilities.
  -- Tenants can only use features that are explicitly enabled for them.
  feature_flags     JSONB       NOT NULL DEFAULT '{"agentControl":false,"sessionReplay":false,"nativeSDK":false}',

  -- JWT SSO configuration for vendor integration.
  -- Schema: { publicKeyPem: string, issuer?: string, audience?: string }
  -- When set, agents can authenticate via RS256-signed JWTs instead of API keys.
  jwt_config        JSONB       DEFAULT NULL,

  is_active         BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Sessions ─────────────────────────────────────────────────────────────────
-- A session represents one co-browse interaction between one agent and one customer.
CREATE TABLE IF NOT EXISTS sessions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- IDs from the integrating CRM / platform
  agent_id          TEXT        NOT NULL,
  customer_id       TEXT        NOT NULL,

  -- Optional reference to the source conversation/case in the CRM
  channel_ref       TEXT,

  -- pending  → agent created, waiting for customer consent
  -- active   → customer consented, co-browse running
  -- ended    → session terminated (any reason)
  status            TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'ended')),

  -- Why the session ended: 'agent', 'customer', 'idle_timeout', 'max_duration', 'error'
  end_reason        TEXT,

  -- Timeline
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invite_sent_at    TIMESTAMPTZ,
  customer_joined_at TIMESTAMPTZ,
  agent_joined_at   TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,

  -- Append-only list of URLs the customer visited during this session.
  -- Populated by the SDK as navigation events arrive.
  urls_visited      TEXT[]      NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_tenant_id ON sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status    ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_agent_id  ON sessions(tenant_id, agent_id);

-- ─── Session Events (Audit Log) ────────────────────────────────────────────────
-- Append-only. Every state change and notable action writes a row here.
-- This is the audit trail. It is never updated — only inserted.
CREATE TABLE IF NOT EXISTS session_events (
  id          BIGSERIAL   PRIMARY KEY,
  session_id  UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL,  -- denormalised for efficient per-tenant exports

  -- Event vocabulary:
  -- session.created       | system  | session was created by agent
  -- customer.invited      | system  | invite published to customer channel
  -- customer.consented    | customer| customer clicked Allow
  -- customer.declined     | customer| customer clicked Decline
  -- customer.joined       | customer| SDK connected and sent first snapshot
  -- agent.joined          | agent   | agent panel connected
  -- session.url_changed   | customer| customer navigated to a new page
  -- agent.pointer_used    | agent   | agent used the pointer overlay
  -- session.idle_warned   | system  | idle warning sent to both parties
  -- session.ended         | agent|customer|system
  event_type  TEXT        NOT NULL,

  -- 'agent', 'customer', 'system'
  actor       TEXT,

  -- Free-form context: { url, reason, agentId, ... }
  metadata    JSONB       NOT NULL DEFAULT '{}',

  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_id ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_session_events_tenant_ts  ON session_events(tenant_id, ts DESC);

-- ─── Session Recordings ──────────────────────────────────────────────────────
-- Metadata for session recordings stored in the configured storage backend
-- (filesystem for dev, S3 for production). The actual event data is gzip-compressed
-- and stored externally; this table only holds metadata and the storage key.
CREATE TABLE IF NOT EXISTS session_recordings (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  storage_key       TEXT,                           -- path or S3 key
  event_count       INTEGER     NOT NULL DEFAULT 0,
  duration_ms       INTEGER,
  compressed_size   INTEGER,
  raw_size          INTEGER,
  status            TEXT        NOT NULL DEFAULT 'recording'
                    CHECK (status IN ('recording', 'complete', 'failed')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordings_session ON session_recordings(session_id);
CREATE INDEX IF NOT EXISTS idx_recordings_tenant  ON session_recordings(tenant_id, created_at DESC);
