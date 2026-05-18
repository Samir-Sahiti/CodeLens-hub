-- Maintenance: prune old api_usage rows.
--
-- The rolling-budget check now reads api_usage_daily (Phase 3), so the raw
-- api_usage table is only needed for audit/debugging. Run this monthly via
-- Supabase SQL Editor to keep the table small.
--
-- Safe to run any time. Does NOT touch api_usage_daily (the rollup is the
-- source of truth for billing/budget after this delete).

DELETE FROM api_usage
 WHERE created_at < NOW() - INTERVAL '30 days';

-- Optional: VACUUM to reclaim space. Skip on Supabase free tier — autovacuum
-- will catch up.
-- VACUUM (ANALYZE) api_usage;
