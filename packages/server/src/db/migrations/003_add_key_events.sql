-- Append-only audit log for API key lifecycle events (creation, rotation)
CREATE TABLE IF NOT EXISTS key_events (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  user_id       UUID REFERENCES vendor_users(id),
  event_type    TEXT NOT NULL,  -- 'keys.created' | 'keys.rotated'
  ip_address    TEXT,
  user_agent    TEXT,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_key_events_tenant ON key_events(tenant_id, created_at DESC);
