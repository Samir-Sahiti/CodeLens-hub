-- =============================================================================
-- Migration: Dependency Vulnerability Scanning (US-045)
-- Run this in the Supabase SQL Editor after schema.sql has been applied.
-- =============================================================================

-- 1. Add 'vulnerable_dependency' to the issue_type enum
ALTER TYPE issue_type ADD VALUE IF NOT EXISTS 'vulnerable_dependency';

-- 2. Vulnerability cache table — keyed on (ecosystem, name, version), TTL 24h
CREATE TABLE IF NOT EXISTS vulnerability_cache (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem       TEXT        NOT NULL,
  package_name    TEXT        NOT NULL,
  package_version TEXT        NOT NULL,
  vulns_json      TEXT        NOT NULL DEFAULT '[]',
  cached_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ecosystem, package_name, package_version)
);

CREATE INDEX IF NOT EXISTS vulnerability_cache_lookup_idx
  ON vulnerability_cache (ecosystem, package_name, package_version);

CREATE INDEX IF NOT EXISTS vulnerability_cache_cached_at_idx
  ON vulnerability_cache (cached_at);

-- RLS: this table is server-side only — accessible via service_role, not anon
ALTER TABLE vulnerability_cache ENABLE ROW LEVEL SECURITY;

-- No user-facing RLS policy — only the backend (service_role) reads/writes it.
-- The service_role bypasses RLS by default.

-- 3. Optional: periodic cleanup job (run manually or via pg_cron if available)
-- DELETE FROM vulnerability_cache WHERE cached_at < NOW() - INTERVAL '24 hours';

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
