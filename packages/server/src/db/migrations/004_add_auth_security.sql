-- Auth security hardening: key expiry + auth failure audit log

-- Opt-in key expiry (NULL = no expiry)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS key_expires_at TIMESTAMPTZ DEFAULT NULL;

-- Append-only audit log for authentication failures
CREATE TABLE IF NOT EXISTS auth_failures (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id),   -- NULL if key didn't match any tenant
  auth_type   TEXT NOT NULL,                  -- 'api_key' | 'portal_login' | 'jwt'
  identifier  TEXT,                           -- masked: 'cb_sk_12****' or 'ad***@foo.com'
  ip_address  TEXT,
  user_agent  TEXT,
  reason      TEXT NOT NULL,                  -- 'invalid_key' | 'inactive_tenant' | 'bad_password' | 'expired_key'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_failures_ip ON auth_failures(ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_failures_tenant ON auth_failures(tenant_id, created_at DESC);
