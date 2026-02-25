-- Migration 001: Add jwt_config column to tenants for vendor JWT SSO.
-- Allows tenants to configure RS256 public keys for agent authentication via JWT.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS jwt_config JSONB DEFAULT NULL;
