-- perf_reindex_migration.sql
-- Run once in the Supabase SQL Editor.
--
-- Fixes two re-index performance problems:
--   1. code_chunks had no repo_id index → full sequential scan on every delete
--   2. Six separate PostgREST calls → FK lock contention on repositories row
--      New function collapses all six deletes into one RPC round trip.

-- 1. Add the missing repo_id index on code_chunks
CREATE INDEX IF NOT EXISTS code_chunks_repo_id_idx ON code_chunks (repo_id);

-- 2. Create (or replace) the single-call clear function
CREATE OR REPLACE FUNCTION clear_repo_derived_data(p_repo_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM code_chunks          WHERE repo_id = p_repo_id;
  DELETE FROM file_contents        WHERE repo_id = p_repo_id;
  DELETE FROM analysis_issues      WHERE repo_id = p_repo_id;
  DELETE FROM graph_edges          WHERE repo_id = p_repo_id;
  DELETE FROM graph_nodes          WHERE repo_id = p_repo_id;
  DELETE FROM dependency_manifests WHERE repo_id = p_repo_id;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_repo_derived_data(UUID) TO service_role;
