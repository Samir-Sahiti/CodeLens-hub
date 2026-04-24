-- =============================================================================
-- CodeLens Hub – Full Schema (idempotent — safe to re-run on any existing DB)
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- PRE-REQUISITE: Enable the pgvector extension first via
--   Dashboard → Database → Extensions → enable "vector"
-- =============================================================================

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

-- =============================================================================
-- ENUMS
-- Wrapped in DO blocks so re-runs skip already-existing types.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE repo_status AS ENUM ('pending', 'indexing', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE repo_source AS ENUM ('github', 'upload');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE issue_type AS ENUM ('circular_dependency', 'god_file', 'dead_code', 'high_coupling');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add enum values introduced in later sprints (safe to re-run)
COMMIT;
ALTER TYPE issue_type ADD VALUE IF NOT EXISTS 'insecure_pattern';
COMMIT;
ALTER TYPE issue_type ADD VALUE IF NOT EXISTS 'hardcoded_secret';

-- =============================================================================
-- FUNCTIONS — Vault wrappers (US-039)
-- CREATE OR REPLACE is always safe to re-run.
-- =============================================================================

-- Each call generates a unique vault secret name so the name uniqueness
-- constraint on vault.secrets is never violated across multiple users.
CREATE OR REPLACE FUNCTION create_github_token_secret(token text)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT vault.create_secret(token, 'github_token_' || gen_random_uuid());
$$;

CREATE OR REPLACE FUNCTION get_github_token_secret(secret_id uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = secret_id;
$$;

REVOKE EXECUTE ON FUNCTION get_github_token_secret FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_github_token_secret TO   service_role;

-- =============================================================================
-- FUNCTIONS — Vector search (US-041)
-- =============================================================================

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
-- PROFILES
-- =============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id                     UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  github_username        TEXT,
  github_token_secret_id UUID,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Column added in US-039 — safe to re-run
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS github_token_secret_id UUID;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own profile" ON profiles;
CREATE POLICY "Users can only access their own profile"
  ON profiles FOR ALL
  USING (auth.uid() = id);

-- =============================================================================
-- REPOSITORIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS repositories (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  full_name         TEXT,
  source            repo_source NOT NULL DEFAULT 'github',
  status            repo_status NOT NULL DEFAULT 'pending',
  github_url        TEXT,
  default_branch    TEXT        DEFAULT 'main',
  file_count        INT         DEFAULT 0,
  indexed_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  webhook_secret    TEXT,
  auto_sync_enabled BOOLEAN     NOT NULL DEFAULT false,
  sast_disabled_rules TEXT[]    DEFAULT '{}'
);

-- Columns added in later sprints — safe to re-run
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS webhook_secret     TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS auto_sync_enabled  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS sast_disabled_rules TEXT[] DEFAULT '{}';

ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own repos"              ON repositories;
DROP POLICY IF EXISTS "Users can access own repos or team-shared repos"    ON repositories;
CREATE POLICY "Users can access own repos or team-shared repos"
  ON repositories FOR ALL
  USING (
    auth.uid() = user_id
    OR id IN (
      SELECT repo_id FROM team_repositories
      WHERE  team_id IN (
        SELECT team_id FROM team_members WHERE user_id = auth.uid()
      )
    )
  );

-- =============================================================================
-- GRAPH NODES
-- =============================================================================

CREATE TABLE IF NOT EXISTS graph_nodes (
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id          UUID  NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path        TEXT  NOT NULL,
  language         TEXT,
  line_count       INT   DEFAULT 0,
  outgoing_count   INT   DEFAULT 0,
  incoming_count   INT   DEFAULT 0,
  complexity_score FLOAT DEFAULT 0,
  content_hash     TEXT,
  UNIQUE (repo_id, file_path)
);

-- Migration for existing deployments: add content_hash if it doesn't exist
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE INDEX IF NOT EXISTS graph_nodes_repo_id_idx ON graph_nodes (repo_id);

-- =============================================================================
-- GRAPH EDGES
-- =============================================================================

CREATE TABLE IF NOT EXISTS graph_edges (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id   UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  from_path TEXT NOT NULL,
  to_path   TEXT NOT NULL,
  UNIQUE (repo_id, from_path, to_path)
);

CREATE INDEX IF NOT EXISTS graph_edges_repo_id_idx   ON graph_edges (repo_id);
CREATE INDEX IF NOT EXISTS graph_edges_from_path_idx ON graph_edges (from_path);
CREATE INDEX IF NOT EXISTS graph_edges_to_path_idx   ON graph_edges (to_path);

-- =============================================================================
-- CODE CHUNKS
-- =============================================================================

CREATE TABLE IF NOT EXISTS code_chunks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id    UUID        NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path  TEXT        NOT NULL,
  content    TEXT        NOT NULL,
  start_line INT,
  end_line   INT,
  embedding  vector(1536)
);

-- HNSW index (US-041): lower latency and higher recall than IVFFlat.
CREATE INDEX IF NOT EXISTS code_chunks_hnsw_idx
  ON code_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS code_chunks_repo_id_idx ON code_chunks (repo_id);

-- =============================================================================
-- ANALYSIS ISSUES
-- =============================================================================

CREATE TABLE IF NOT EXISTS analysis_issues (
  id          UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     UUID       NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  type        issue_type NOT NULL,
  severity    TEXT       CHECK (severity IN ('low', 'medium', 'high')),
  file_paths  TEXT[]     NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS analysis_issues_repo_id_idx ON analysis_issues (repo_id);

-- =============================================================================
-- ISSUE SUPPRESSIONS (US-044 / US-046)
-- Per-instance false-positive suppression — rule-agnostic so US-049 can reuse it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS issue_suppressions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     UUID        NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path   TEXT        NOT NULL,
  rule_id     TEXT        NOT NULL,
  line_number INT,
  created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo_id, file_path, rule_id, line_number)
);

CREATE INDEX IF NOT EXISTS issue_suppressions_repo_id_idx ON issue_suppressions (repo_id);

ALTER TABLE issue_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access suppressions for their repos" ON issue_suppressions;
CREATE POLICY "Users can only access suppressions for their repos"
  ON issue_suppressions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM repositories
      WHERE repositories.id = issue_suppressions.repo_id
        AND repositories.user_id = auth.uid()
    )
  );

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

ALTER TABLE teams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_repositories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members can view their teams"           ON teams;
DROP POLICY IF EXISTS "Team owners can manage their teams"          ON teams;
DROP POLICY IF EXISTS "Team members can view members of their teams" ON team_members;
DROP POLICY IF EXISTS "Team members can view team repositories"     ON team_repositories;

CREATE POLICY "Team members can view their teams"
  ON teams FOR SELECT
  USING (id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));

CREATE POLICY "Team owners can manage their teams"
  ON teams FOR ALL
  USING (created_by = auth.uid());

CREATE POLICY "Team members can view members of their teams"
  ON team_members FOR SELECT
  USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));

CREATE POLICY "Team members can view team repositories"
  ON team_repositories FOR SELECT
  USING (team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid()));

-- =============================================================================
-- API USAGE (US-042)
-- Records per-request token consumption for rate limiting and cost control.
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_usage (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint          TEXT        NOT NULL,
  provider          TEXT        NOT NULL,
  prompt_tokens     INT         NOT NULL DEFAULT 0,
  completion_tokens INT         NOT NULL DEFAULT 0,
  embedding_tokens  INT         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supports the rolling 24-hour budget query
CREATE INDEX IF NOT EXISTS api_usage_user_created_idx ON api_usage (user_id, created_at);

-- =============================================================================
-- FILE CONTENTS (US-043)
-- Full raw source per indexed file — fixes the chunk-reconstruction gap in
-- the file browser. 1 MB cap enforced by the indexing pipeline.
-- =============================================================================

CREATE TABLE IF NOT EXISTS file_contents (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id    UUID        NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path  TEXT        NOT NULL,
  content    TEXT        NOT NULL,
  byte_size  INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo_id, file_path)
);

CREATE INDEX IF NOT EXISTS file_contents_repo_id_idx ON file_contents (repo_id);

ALTER TABLE file_contents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Access file contents via repo ownership" ON file_contents;
CREATE POLICY "Access file contents via repo ownership"
  ON file_contents FOR SELECT
  USING (
    repo_id IN (
      SELECT id FROM repositories
      WHERE  user_id = auth.uid()
      OR id IN (
        SELECT repo_id FROM team_repositories
        WHERE team_id IN (
          SELECT team_id FROM team_members WHERE user_id = auth.uid()
        )
      )
    )
  );

-- =============================================================================
-- DEPENDENCY VULNERABILITY SCANNING (US-045)
-- vulnerability_cache is shared across all users/repos and NOT cleared on
-- re-index — it is an application-level cache with a 24-hour TTL.
-- dependency_manifests is per-repo and cleared via ON DELETE CASCADE.
-- =============================================================================

-- New enum value
COMMIT;
ALTER TYPE issue_type ADD VALUE IF NOT EXISTS 'vulnerable_dependency';

-- Both tables are safe to drop on re-run: vulnerability_cache is an OSV API
-- cache (repopulates on next indexing run) and dependency_manifests is wiped
-- and rebuilt on every re-index anyway. Explicit DROP avoids IF NOT EXISTS
-- silently preserving a table that was partially created with wrong column names.
DROP TABLE IF EXISTS dependency_manifests CASCADE;
DROP TABLE IF EXISTS vulnerability_cache  CASCADE;

CREATE TABLE vulnerability_cache (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem    TEXT        NOT NULL,
  package_name TEXT        NOT NULL,
  pkg_version  TEXT        NOT NULL,
  vulns        JSONB       NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ecosystem, package_name, pkg_version)
);

CREATE INDEX vulnerability_cache_lookup_idx
  ON vulnerability_cache (ecosystem, package_name, pkg_version);

CREATE INDEX vulnerability_cache_created_at_idx
  ON vulnerability_cache (created_at);

ALTER TABLE vulnerability_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can use vulnerability cache"
  ON vulnerability_cache FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Per-repo detected dependency manifests (rebuilt on every re-index via CASCADE).
CREATE TABLE dependency_manifests (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id       UUID        NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  manifest_path TEXT        NOT NULL,
  ecosystem     TEXT        NOT NULL,
  package_name  TEXT        NOT NULL,
  pkg_version   TEXT,
  is_transitive BOOLEAN     NOT NULL DEFAULT false,
  vuln_count    INT         NOT NULL DEFAULT 0,
  vulns_json    JSONB       NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo_id, manifest_path, ecosystem, package_name, pkg_version)
);

CREATE INDEX dependency_manifests_repo_id_idx
  ON dependency_manifests (repo_id);

ALTER TABLE dependency_manifests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access dependency manifests for their repos" ON dependency_manifests;
CREATE POLICY "Users can access dependency manifests for their repos"
  ON dependency_manifests FOR ALL
  USING (
    repo_id IN (
      SELECT id FROM repositories
      WHERE  user_id = auth.uid()
      OR id IN (
        SELECT repo_id FROM team_repositories
        WHERE team_id IN (
          SELECT team_id FROM team_members WHERE user_id = auth.uid()
        )
      )
    )
  );

-- =============================================================================
-- REINDEX CLEAR FUNCTION
-- Deletes all derived data for a repo in a single transaction (1 RPC round
-- trip instead of 6 separate PostgREST calls, avoiding per-table FK lock
-- contention on the repositories parent row).
-- =============================================================================

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

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
