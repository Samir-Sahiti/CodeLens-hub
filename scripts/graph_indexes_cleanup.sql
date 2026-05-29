-- graph_indexes_cleanup.sql
--
-- Drops two single-column indexes on graph_edges that are dead weight:
--
--   graph_edges_from_path_idx  ON graph_edges (from_path)
--   graph_edges_to_path_idx    ON graph_edges (to_path)
--
-- All real queries against graph_edges filter by repo_id first, so the
-- composite indexes added in Phase 6 (graph_edges_repo_from_idx and
-- graph_edges_repo_to_idx) are what the planner actually uses. The
-- single-column ones never match a query but still cost write amplification
-- on every indexer upsert.
--
-- Idempotent — safe to re-run.

DROP INDEX IF EXISTS graph_edges_from_path_idx;
DROP INDEX IF EXISTS graph_edges_to_path_idx;
