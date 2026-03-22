-- =============================================================================
-- CodeLens Hub – Initial Schema Migration
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- PRE-REQUISITE: Enable the pgvector extension first via
--   Dashboard → Database → Extensions → enable "vector"
-- =============================================================================

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE repo_status AS ENUM ('pending', 'indexing', 'ready', 'failed');
CREATE TYPE repo_source AS ENUM ('github', 'upload');
CREATE TYPE issue_type  AS ENUM ('circular_dependency', 'god_file', 'dead_code', 'high_coupling');

-- =============================================================================
-- PROFILES
-- Extends Supabase auth.users with app-level data.
-- =============================================================================

CREATE TABLE profiles (
  id                  UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  github_username     TEXT,
  -- TODO: move github_access_token to Supabase Vault before production.
  --       Currently stored in plaintext – acceptable only for development.
  github_access_token TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own profile"
  ON profiles
  FOR ALL
  USING (auth.uid() = id);

-- =============================================================================
-- REPOSITORIES
-- One row per repo connected or uploaded by a user.
-- =============================================================================

CREATE TABLE repositories (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  full_name      TEXT,
  source         repo_source NOT NULL DEFAULT 'github',
  status         repo_status NOT NULL DEFAULT 'pending',
  github_url     TEXT,
  default_branch TEXT        DEFAULT 'main',
  file_count     INT         DEFAULT 0,
  indexed_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own repos"
  ON repositories
  FOR ALL
  USING (auth.uid() = user_id);

-- =============================================================================
-- GRAPH NODES
-- One node per file in an indexed repository.
-- =============================================================================

CREATE TABLE graph_nodes (
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id          UUID  NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path        TEXT  NOT NULL,
  language         TEXT,
  line_count       INT   DEFAULT 0,
  outgoing_count   INT   DEFAULT 0,
  incoming_count   INT   DEFAULT 0,
  complexity_score FLOAT DEFAULT 0,
  UNIQUE (repo_id, file_path)
);

CREATE INDEX ON graph_nodes (repo_id);

-- NOTE: graph_nodes does NOT need per-user RLS because access is mediated
-- through the repositories table (which is already RLS-protected).
-- All queries should join through repositories to enforce ownership.

-- =============================================================================
-- GRAPH EDGES
-- Directed dependency relationships between files.
-- =============================================================================

CREATE TABLE graph_edges (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id   UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  from_path TEXT NOT NULL,
  to_path   TEXT NOT NULL,
  UNIQUE (repo_id, from_path, to_path)
);

CREATE INDEX ON graph_edges (repo_id);
CREATE INDEX ON graph_edges (from_path);
CREATE INDEX ON graph_edges (to_path);

-- =============================================================================
-- CODE CHUNKS
-- Chunked file content with vector embeddings for RAG / semantic search.
-- =============================================================================

CREATE TABLE code_chunks (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id    UUID    NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path  TEXT    NOT NULL,
  content    TEXT    NOT NULL,
  start_line INT,
  end_line   INT,
  embedding  vector(1536)
);

-- IVFFlat index for approximate nearest-neighbour cosine similarity search.
-- Requires at least a few thousand rows before it outperforms a sequential scan.
CREATE INDEX ON code_chunks USING ivfflat (embedding vector_cosine_ops);

-- =============================================================================
-- ANALYSIS ISSUES
-- Architectural issues detected during repo analysis.
-- =============================================================================

CREATE TABLE analysis_issues (
  id          UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     UUID       NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  type        issue_type NOT NULL,
  severity    TEXT       CHECK (severity IN ('low', 'medium', 'high')),
  file_paths  TEXT[]     NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON analysis_issues (repo_id);

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
