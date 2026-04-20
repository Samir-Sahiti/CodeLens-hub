-- =============================================================================
-- CodeLens Hub – Full Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- PRE-REQUISITE: Enable the pgvector extension first via
--   Dashboard → Database → Extensions → enable "vector"
-- =============================================================================

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

-- =============================================================================
-- FUNCTIONS (Vault wrappers for US-039)
-- =============================================================================

CREATE OR REPLACE FUNCTION create_github_token_secret(token text)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT vault.create_secret(token, 'github_access_token');
$$;

CREATE OR REPLACE FUNCTION get_github_token_secret(secret_id uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = secret_id;
$$;

-- Secure decryption function
REVOKE EXECUTE ON FUNCTION get_github_token_secret FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_github_token_secret TO service_role;

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
  id                     UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  github_username        TEXT,
  -- Replaced by Vault: plaintext migration was processed in US-039.
  -- Original field was github_access_token TEXT.
  github_token_secret_id UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  full_name        TEXT,
  source           repo_source NOT NULL DEFAULT 'github',
  status           repo_status NOT NULL DEFAULT 'pending',
  github_url       TEXT,
  default_branch   TEXT        DEFAULT 'main',
  file_count       INT         DEFAULT 0,
  indexed_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  webhook_secret    TEXT,
  auto_sync_enabled BOOLEAN    NOT NULL DEFAULT false
);

ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;

-- Replaced by the broader team-access policy below.
-- CREATE POLICY "Users can only access their own repos" ...

CREATE POLICY "Users can access own repos or team-shared repos"
  ON repositories FOR ALL
  USING (
    auth.uid() = user_id
    OR id IN (
      SELECT repo_id
      FROM   team_repositories
      WHERE  team_id IN (
        SELECT team_id FROM team_members WHERE user_id = auth.uid()
      )
    )
  );

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

-- HNSW index for approximate nearest-neighbour cosine similarity search. (US-041)
-- Migrated from IVFFlat: HNSW gives lower latency and higher recall on read-heavy RAG workloads.
-- m=16 controls graph connectivity; ef_construction=64 controls build-time quality.
CREATE INDEX ON code_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- =============================================================================
-- FUNCTIONS (Vector search with tunable ef_search for US-041)
-- =============================================================================

-- match_code_chunks: Finds top-k code chunks for a given embedding.
-- Uses SET LOCAL to bump ef_search to 100 for higher recall per request.
CREATE OR REPLACE FUNCTION match_code_chunks(
  p_repo_id   UUID,
  p_embedding vector(1536),
  p_top_k     INT DEFAULT 8
)
RETURNS TABLE (
  file_path  TEXT,
  start_line INT,
  end_line   INT,
  content    TEXT,
  distance   FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Higher ef_search trades query time for better recall; safe for RAG workloads.
  SET LOCAL hnsw.ef_search = 100;

  RETURN QUERY
  SELECT
    cc.file_path,
    cc.start_line,
    cc.end_line,
    cc.content,
    (cc.embedding <=> p_embedding)::FLOAT AS distance
  FROM code_chunks cc
  WHERE cc.repo_id = p_repo_id
  ORDER BY cc.embedding <=> p_embedding
  LIMIT p_top_k;
END;
$$;

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
-- TEAMS / ORGANIZATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS teams (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  created_by UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  github_username TEXT        NOT NULL,
  role            TEXT        NOT NULL DEFAULT 'member'
                              CHECK (role IN ('owner', 'member')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, github_username)
);

CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON team_members (user_id);
CREATE INDEX IF NOT EXISTS team_members_team_id_idx ON team_members (team_id);

CREATE TABLE IF NOT EXISTS team_repositories (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (team_id, repo_id)
);

CREATE INDEX IF NOT EXISTS team_repositories_team_id_idx ON team_repositories (team_id);
CREATE INDEX IF NOT EXISTS team_repositories_repo_id_idx ON team_repositories (repo_id);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE teams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_repositories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view their teams"
  ON teams FOR SELECT
  USING (
    id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Team owners can manage their teams"
  ON teams FOR ALL
  USING (created_by = auth.uid());

CREATE POLICY "Team members can view members of their teams"
  ON team_members FOR SELECT
  USING (
    team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Team members can view team repositories"
  ON team_repositories FOR SELECT
  USING (
    team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
