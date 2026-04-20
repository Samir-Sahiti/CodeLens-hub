-- =============================================================================
-- US-043 Migration: Full file content storage
-- Run once in the Supabase SQL Editor after applying schema.sql changes.
-- Safe to re-run (idempotent).
-- =============================================================================

-- Mark all currently-ready repos as pending so the next visit triggers a
-- re-index that populates the new file_contents table.
-- Users will see a brief "Indexing" state — this is expected and documented.
UPDATE repositories
SET status = 'pending'
WHERE status = 'ready';
