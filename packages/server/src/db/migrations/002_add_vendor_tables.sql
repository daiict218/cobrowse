-- 002_add_vendor_tables.sql
-- Adds vendor management tables for the portal.
-- Vendors (e.g. Sprinklr, Zendesk) own one or more tenants.

-- ─── Vendors ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  contact_email TEXT NOT NULL UNIQUE,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Vendor Portal Users ──────────────────────────────────────────────────────
-- Email/password auth for the vendor management portal.
CREATE TABLE IF NOT EXISTS vendor_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── DB-backed Portal Sessions ────────────────────────────────────────────────
-- httpOnly cookie → session row. Survives server restarts, works multi-instance.
CREATE TABLE IF NOT EXISTS portal_sessions (
  id              TEXT PRIMARY KEY,
  vendor_user_id  UUID NOT NULL REFERENCES vendor_users(id) ON DELETE CASCADE,
  vendor_id       UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  ip_address      TEXT,
  user_agent      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Link tenants → vendors ───────────────────────────────────────────────────
-- Nullable for backward compatibility with existing demo tenant.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tenants_vendor_id ON tenants(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_users_vendor_id ON vendor_users(vendor_id);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_expires ON portal_sessions(expires_at);
