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
COMMIT;
ALTER TYPE issue_type ADD VALUE IF NOT EXISTS 'missing_auth';
COMMIT;
ALTER TYPE issue_type ADD VALUE IF NOT EXISTS 'refactoring_candidate';
COMMIT;
ALTER TYPE issue_type ADD VALUE IF NOT EXISTS 'untested_critical_file';

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

REVOKE ALL ON FUNCTION get_github_token_secret FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_github_token_secret TO authenticated, service_role;

CREATE OR REPLACE FUNCTION can_access_repo(
  p_repo_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM repositories r
    WHERE r.id = p_repo_id
      AND (
        r.user_id = p_user_id
        OR EXISTS (
          SELECT 1
          FROM team_repositories tr
          JOIN team_members tm ON tm.team_id = tr.team_id
          WHERE tr.repo_id = r.id
            AND tm.user_id = p_user_id
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION can_access_repo(UUID, UUID) TO authenticated, service_role;

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
  has_coverage_files BOOLEAN    NOT NULL DEFAULT false,
  language_stats    JSONB       DEFAULT '[]',
  sast_disabled_rules TEXT[]    DEFAULT '{}',
  latest_indexed_sha TEXT
);

-- Columns added in later sprints — safe to re-run
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS webhook_secret     TEXT;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS auto_sync_enabled  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS has_coverage_files BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS language_stats JSONB DEFAULT '[]';
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS sast_disabled_rules TEXT[] DEFAULT '{}';
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS latest_indexed_sha TEXT;

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
-- US-047: attack surface classification ('source', 'sink', 'both', or null)
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS node_classification TEXT;
-- US-053: test coverage overlay and formal coverage overrides
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS has_test_coverage BOOLEAN DEFAULT FALSE;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS is_test_file BOOLEAN DEFAULT FALSE;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS coverage_percentage FLOAT;
ALTER TABLE graph_nodes DROP CONSTRAINT IF EXISTS graph_nodes_coverage_percentage_bounds;
ALTER TABLE graph_nodes ADD CONSTRAINT graph_nodes_coverage_percentage_bounds
  CHECK (coverage_percentage IS NULL OR (coverage_percentage >= 0 AND coverage_percentage <= 100));

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
-- NOTE: single-column (from_path) and (to_path) indexes were dropped; the
-- composite (repo_id, from_path) and (repo_id, to_path) indexes added in
-- the Phase 6 block below are what the planner actually uses. See
-- scripts/graph_indexes_cleanup.sql for the matching drop migration.

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
-- DUPLICATION CANDIDATES (US-052)
-- Canonical duplicate chunk pairs only. Clusters are computed in-memory from
-- this table at request time; no cluster table is persisted.
-- =============================================================================

CREATE TABLE IF NOT EXISTS duplication_candidates (
  id         UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id    UUID  NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  chunk_a_id UUID  NOT NULL REFERENCES code_chunks(id) ON DELETE CASCADE,
  chunk_b_id UUID  NOT NULL REFERENCES code_chunks(id) ON DELETE CASCADE,
  similarity FLOAT NOT NULL CHECK (similarity > 0.92 AND similarity <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (chunk_a_id < chunk_b_id),
  UNIQUE (repo_id, chunk_a_id, chunk_b_id)
);

CREATE INDEX IF NOT EXISTS duplication_candidates_repo_id_idx
  ON duplication_candidates (repo_id);
CREATE INDEX IF NOT EXISTS duplication_candidates_chunk_a_idx
  ON duplication_candidates (chunk_a_id);
CREATE INDEX IF NOT EXISTS duplication_candidates_chunk_b_idx
  ON duplication_candidates (chunk_b_id);

ALTER TABLE duplication_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access duplication candidates for their repos" ON duplication_candidates;
CREATE POLICY "Users can access duplication candidates for their repos"
  ON duplication_candidates FOR SELECT
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

CREATE OR REPLACE FUNCTION find_duplicate_chunk_pairs(
  p_repo_id UUID,
  p_threshold FLOAT DEFAULT 0.92
)
RETURNS TABLE (
  repo_id UUID,
  chunk_a_id UUID,
  chunk_b_id UUID,
  similarity FLOAT
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  eligible_count INT;
BEGIN
  SELECT COUNT(*)
  INTO eligible_count
  FROM code_chunks cc
  WHERE cc.repo_id = p_repo_id
    AND cc.embedding IS NOT NULL
    AND cc.start_line IS NOT NULL
    AND cc.end_line IS NOT NULL
    AND (cc.end_line - cc.start_line + 1) >= 10;

  IF eligible_count = 0 THEN
    RETURN;
  END IF;

  IF eligible_count <= 5000 THEN
    RETURN QUERY
    WITH eligible AS (
      SELECT cc.id, cc.repo_id, cc.embedding
      FROM code_chunks cc
      WHERE cc.repo_id = p_repo_id
        AND cc.embedding IS NOT NULL
        AND cc.start_line IS NOT NULL
        AND cc.end_line IS NOT NULL
        AND (cc.end_line - cc.start_line + 1) >= 10
    )
    SELECT
      p_repo_id,
      LEAST(a.id, b.id) AS chunk_a_id,
      GREATEST(a.id, b.id) AS chunk_b_id,
      (1 - (a.embedding <=> b.embedding))::FLOAT AS similarity
    FROM eligible a
    JOIN eligible b
      ON a.repo_id = b.repo_id
     AND a.id < b.id
    WHERE (1 - (a.embedding <=> b.embedding)) > p_threshold;
  ELSE
    RETURN QUERY
    WITH eligible AS (
      SELECT cc.id, cc.repo_id, cc.embedding
      FROM code_chunks cc
      WHERE cc.repo_id = p_repo_id
        AND cc.embedding IS NOT NULL
        AND cc.start_line IS NOT NULL
        AND cc.end_line IS NOT NULL
        AND (cc.end_line - cc.start_line + 1) >= 10
    ),
    raw_pairs AS (
      SELECT
        a.id AS id1,
        b.id AS id2,
        (1 - (a.embedding <=> b.embedding))::FLOAT AS similarity
      FROM eligible a
      JOIN LATERAL (
        SELECT e.id, e.embedding
        FROM eligible e
        WHERE e.repo_id = a.repo_id
          AND e.id != a.id
        ORDER BY a.embedding <=> e.embedding
        LIMIT 5
      ) b ON true
      WHERE (1 - (a.embedding <=> b.embedding)) > p_threshold
    ),
    canonical AS (
      SELECT
        LEAST(id1, id2) AS chunk_a_id,
        GREATEST(id1, id2) AS chunk_b_id,
        MAX(similarity)::FLOAT AS similarity
      FROM raw_pairs
      WHERE id1 != id2
      GROUP BY LEAST(id1, id2), GREATEST(id1, id2)
    )
    SELECT p_repo_id, c.chunk_a_id, c.chunk_b_id, c.similarity
    FROM canonical c
    WHERE c.chunk_a_id < c.chunk_b_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION find_duplicate_chunk_pairs(UUID, FLOAT) TO service_role;

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
-- US-072 / US-073: PR review persistence schema and repo flag
-- Idempotent additions: new repo column, pr_reviews table, pr_review_comments,
-- indexes, RLS policies, and updated_at trigger binding.
-- =============================================================================

-- Per-repo opt-in for PR review pipeline
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS pr_review_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS pr_review_auto_publish BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE repositories ADD COLUMN IF NOT EXISTS pr_review_block_on_severity TEXT NOT NULL DEFAULT 'critical';
ALTER TABLE repositories DROP CONSTRAINT IF EXISTS repositories_pr_review_block_on_severity_check;
ALTER TABLE repositories ADD CONSTRAINT repositories_pr_review_block_on_severity_check
  CHECK (pr_review_block_on_severity IN ('critical', 'high'));

-- PR review status enum
DO $$ BEGIN
  CREATE TYPE pr_review_status AS ENUM ('pending', 'analyzing', 'ready', 'failed', 'stale');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- pr_reviews table — stores deterministic review results per PR head
CREATE TABLE IF NOT EXISTS pr_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id        UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  pr_number      INT  NOT NULL,
  pr_head_sha    TEXT NOT NULL,
  pr_base_sha    TEXT,
  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status         pr_review_status NOT NULL DEFAULT 'pending',
  findings_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary        TEXT,
  total_findings INT  NOT NULL DEFAULT 0,
  severity_counts JSONB NOT NULL DEFAULT ('{"critical":0,"high":0,"medium":0,"low":0}'::jsonb),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo_id, pr_number, pr_head_sha)
);

CREATE INDEX IF NOT EXISTS pr_reviews_repo_pr_created_idx ON pr_reviews (repo_id, pr_number, created_at DESC);
CREATE INDEX IF NOT EXISTS pr_reviews_repo_id_idx ON pr_reviews (repo_id);

ALTER TABLE pr_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access pr_reviews for their repos" ON pr_reviews;
CREATE POLICY "Users can access pr_reviews for their repos"
  ON pr_reviews FOR ALL
  USING (can_access_repo(repo_id, auth.uid()))
  WITH CHECK (can_access_repo(repo_id, auth.uid()));

-- pr_review_comments — stores GitHub comment ids for idempotent publishes
CREATE TABLE IF NOT EXISTS pr_review_comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id         UUID NOT NULL REFERENCES pr_reviews(id) ON DELETE CASCADE,
  github_comment_id BIGINT,
  file_path         TEXT,
  line_number       INT,
  kind              TEXT NOT NULL CHECK (kind IN ('inline','summary')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pr_review_comments_review_idx ON pr_review_comments (review_id);

ALTER TABLE pr_review_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access pr_review_comments for their repos" ON pr_review_comments;
CREATE POLICY "Users can access pr_review_comments for their repos"
  ON pr_review_comments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM pr_reviews pr
      WHERE pr.id = pr_review_comments.review_id
        AND can_access_repo(pr.repo_id, auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pr_reviews pr
      WHERE pr.id = pr_review_comments.review_id
        AND can_access_repo(pr.repo_id, auth.uid())
    )
  );

-- Bind updated_at trigger using existing set_updated_at() function
DROP TRIGGER IF EXISTS pr_reviews_set_updated_at ON pr_reviews;
CREATE TRIGGER pr_reviews_set_updated_at BEFORE UPDATE ON pr_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


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
-- SECURITY AUDITS (US-048)
-- AI security audit history. findings_json is an object containing status,
-- files, summary, deterministic_links, and raw_text.
-- =============================================================================

CREATE TABLE IF NOT EXISTS security_audits (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo_id       UUID        NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  findings_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS security_audits_user_repo_created_idx
  ON security_audits (user_id, repo_id, created_at DESC);

ALTER TABLE security_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access their own security audits" ON security_audits;
CREATE POLICY "Users can access their own security audits"
  ON security_audits FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION get_security_audit_targets(
  p_repo_id UUID,
  p_limit   INT DEFAULT 20
)
RETURNS TABLE (
  id               UUID,
  file_path        TEXT,
  language         TEXT,
  line_count       INT,
  incoming_count   INT,
  complexity_score FLOAT,
  audit_score      FLOAT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    gn.id,
    gn.file_path,
    gn.language,
    gn.line_count,
    gn.incoming_count,
    gn.complexity_score,
    (COALESCE(gn.incoming_count, 0) + COALESCE(gn.complexity_score, 0))::FLOAT AS audit_score
  FROM graph_nodes gn
  WHERE gn.repo_id = p_repo_id
  ORDER BY (COALESCE(gn.incoming_count, 0) + COALESCE(gn.complexity_score, 0)) DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_security_audit_targets(UUID, INT) TO service_role;

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
-- FILE CHURN (US-050)
-- Per-file Git commit statistics from the last 12 months.
-- Rebuilt on every re-index for GitHub repos; upload-source repos leave this empty.
-- =============================================================================

CREATE TABLE IF NOT EXISTS file_churn (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id        UUID        NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path      TEXT        NOT NULL,
  commit_count   INT         NOT NULL DEFAULT 0,
  unique_authors INT         NOT NULL DEFAULT 0,
  lines_changed  INT         NOT NULL DEFAULT 0,
  last_modified  TIMESTAMPTZ,
  UNIQUE (repo_id, file_path)
);

CREATE INDEX IF NOT EXISTS file_churn_repo_id_idx ON file_churn (repo_id);

ALTER TABLE file_churn ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can access file_churn for their repos" ON file_churn;
CREATE POLICY "Users can access file_churn for their repos"
  ON file_churn FOR ALL
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
  DELETE FROM duplication_candidates WHERE repo_id = p_repo_id;
  DELETE FROM analysis_issues      WHERE repo_id = p_repo_id;
  DELETE FROM graph_edges          WHERE repo_id = p_repo_id;
  DELETE FROM graph_nodes          WHERE repo_id = p_repo_id;
  DELETE FROM dependency_manifests WHERE repo_id = p_repo_id;
  DELETE FROM file_churn           WHERE repo_id = p_repo_id;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_repo_derived_data(UUID) TO service_role;

-- =============================================================================
-- TOURS (US-054)
-- Persists guided code walkthroughs and their ordered steps.
-- =============================================================================

CREATE TABLE IF NOT EXISTS tours (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id           UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  created_by        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  original_query    TEXT,
  is_auto_generated BOOLEAN NOT NULL DEFAULT false,
  is_team_shared    BOOLEAN NOT NULL DEFAULT false,
  forked_from       UUID REFERENCES tours(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tours_repo_id_shared_idx ON tours (repo_id, is_team_shared);

ALTER TABLE tours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own or team-shared tours" ON tours;
CREATE POLICY "Users can read own or team-shared tours" ON tours FOR SELECT
  USING (
    created_by = auth.uid()
    OR (
      is_team_shared = true
      AND repo_id IN (
        SELECT repo_id FROM team_repositories
        WHERE team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Users can manage own tours" ON tours;
CREATE POLICY "Users can manage own tours" ON tours
  FOR ALL USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());

-- tour_steps: ordered steps within a tour

CREATE TABLE IF NOT EXISTS tour_steps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_id     UUID NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  step_order  INT NOT NULL,
  file_path   TEXT NOT NULL,
  start_line  INT,
  end_line    INT,
  explanation TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tour_id, step_order)
);

CREATE INDEX IF NOT EXISTS tour_steps_tour_id_order_idx ON tour_steps (tour_id, step_order);

ALTER TABLE tour_steps ENABLE ROW LEVEL SECURITY;

-- Read steps of any tour the user can see (own + team-shared)
DROP POLICY IF EXISTS "Users can access steps of accessible tours" ON tour_steps;
DROP POLICY IF EXISTS "Users can read steps of accessible tours" ON tour_steps;
CREATE POLICY "Users can read steps of accessible tours" ON tour_steps FOR SELECT
  USING (
    tour_id IN (
      SELECT id FROM tours
      WHERE created_by = auth.uid()
        OR (
          is_team_shared = true
          AND repo_id IN (
            SELECT repo_id FROM team_repositories
            WHERE team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
          )
        )
    )
  );

-- Write (INSERT / UPDATE / DELETE) steps only for tours the user owns
DROP POLICY IF EXISTS "Users can write steps of own tours" ON tour_steps;
CREATE POLICY "Users can write steps of own tours" ON tour_steps
  FOR ALL
  USING  (tour_id IN (SELECT id FROM tours WHERE created_by = auth.uid()))
  WITH CHECK (tour_id IN (SELECT id FROM tours WHERE created_by = auth.uid()));

-- updated_at trigger for tours

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tours_set_updated_at ON tours;
CREATE TRIGGER tours_set_updated_at BEFORE UPDATE ON tours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- US-060: atomic update of a tour and its steps
-- =============================================================================
-- Receives the new step list as JSONB; renumbers step_order 1..N on insert so
-- the client never has to reconcile ordering. DELETE + INSERT inside the same
-- statement-level transaction (PostgreSQL functions are atomic by default).
-- Caller-provided title/description/is_team_shared are coalesced — pass NULL to
-- leave existing values untouched.

CREATE OR REPLACE FUNCTION update_tour_with_steps(
  p_tour_id        UUID,
  p_title          TEXT,
  p_description    TEXT,
  p_is_team_shared BOOLEAN,
  p_steps          JSONB
) RETURNS VOID AS $$
BEGIN
  UPDATE tours
     SET title          = COALESCE(p_title, title),
         description    = COALESCE(p_description, description),
         is_team_shared = COALESCE(p_is_team_shared, is_team_shared)
   WHERE id = p_tour_id;

  DELETE FROM tour_steps WHERE tour_id = p_tour_id;

  INSERT INTO tour_steps (tour_id, step_order, file_path, start_line, end_line, explanation)
  SELECT
    p_tour_id,
    (row_number() OVER (ORDER BY ord))::INT AS step_order,
    file_path,
    start_line,
    end_line,
    explanation
  FROM jsonb_to_recordset(p_steps) AS s(
    ord         INT,
    file_path   TEXT,
    start_line  INT,
    end_line    INT,
    explanation TEXT
  );
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION update_tour_with_steps(UUID, TEXT, TEXT, BOOLEAN, JSONB) TO service_role;

-- =============================================================================
-- US-061: deep-copy a tour into a fork for the current user
-- =============================================================================
-- Returns the new tour's id. forked_from points back to the source; the fork
-- starts unshared and titled "Copy of {original}". Steps are duplicated with
-- their original step_order preserved.

CREATE OR REPLACE FUNCTION fork_tour(p_tour_id UUID, p_user_id UUID)
RETURNS UUID AS $$
DECLARE
  v_new_tour_id UUID;
BEGIN
  INSERT INTO tours (repo_id, created_by, title, description, original_query, is_auto_generated, is_team_shared, forked_from)
  SELECT repo_id,
         p_user_id,
         'Copy of ' || title,
         description,
         original_query,
         false,
         false,
         id
    FROM tours
   WHERE id = p_tour_id
  RETURNING id INTO v_new_tour_id;

  IF v_new_tour_id IS NULL THEN
    RAISE EXCEPTION 'Source tour % not found', p_tour_id;
  END IF;

  INSERT INTO tour_steps (tour_id, step_order, file_path, start_line, end_line, explanation)
  SELECT v_new_tour_id, step_order, file_path, start_line, end_line, explanation
    FROM tour_steps
   WHERE tour_id = p_tour_id;

  RETURN v_new_tour_id;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION fork_tour(UUID, UUID) TO service_role;

-- =============================================================================
-- US-064: per-importer symbol tracking on graph_edges
-- Each edge optionally records the set of symbols the importer references from
-- the target file. Stored as TEXT[] (rather than one row per symbol) so the
-- existing (repo_id, from_path, to_path) UNIQUE constraint and upsert path stay
-- unchanged. Existing edges from older indexer runs carry an empty array.
-- =============================================================================

ALTER TABLE graph_edges ADD COLUMN IF NOT EXISTS symbols TEXT[] NOT NULL DEFAULT '{}';

-- =============================================================================
-- US-063: AI refactor proposals
-- One pending proposal per (user, analysis_issue). Older proposals stay around
-- with status applied/discarded/stale for the per-user history view.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE proposal_status AS ENUM ('pending', 'applied', 'discarded', 'stale');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS issue_proposals (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id          UUID            NOT NULL REFERENCES analysis_issues(id) ON DELETE CASCADE,
  user_id           UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status            proposal_status NOT NULL DEFAULT 'pending',
  proposal_json     JSONB           NOT NULL,
  branch_name       TEXT,
  pr_url            TEXT,
  prompt_tokens     INTEGER         NOT NULL DEFAULT 0,
  completion_tokens INTEGER         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS issue_proposals_issue_created_idx
  ON issue_proposals (issue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS issue_proposals_user_created_idx
  ON issue_proposals (user_id, created_at DESC);

ALTER TABLE issue_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access only their own proposals" ON issue_proposals;
CREATE POLICY "Users access only their own proposals"
  ON issue_proposals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS issue_proposals_set_updated_at ON issue_proposals;
CREATE TRIGGER issue_proposals_set_updated_at
  BEFORE UPDATE ON issue_proposals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- Phase 2.1: prepare_repo_reindex
-- Bundles the indexer's issue-preservation + clearing phase into ONE RPC so a
-- 1000-file re-index drops from ~10 sequential PostgREST round-trips to one
-- transactional SQL call. Returns row counts for indexer logging.
-- =============================================================================

CREATE OR REPLACE FUNCTION prepare_repo_reindex(
  p_repo_id                   UUID,
  p_unchanged_paths           TEXT[],
  p_changed_or_deleted_paths  TEXT[],
  p_preserve_churn            BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  preserved_count INTEGER,
  deleted_count   INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_preservable_types TEXT[] := ARRAY['hardcoded_secret', 'insecure_pattern', 'missing_auth'];
  v_preserved_count   INTEGER := 0;
  v_deleted_count     INTEGER := 0;
  v_unchanged         TEXT[]  := COALESCE(p_unchanged_paths, ARRAY[]::TEXT[]);
  v_changed_deleted   TEXT[]  := COALESCE(p_changed_or_deleted_paths, ARRAY[]::TEXT[]);
BEGIN
  -- 1. Mark pending proposals stale for issues we're about to delete.
  --    Done BEFORE the delete so anyone observing the row during the
  --    transaction sees the 'stale' status before CASCADE removes it.
  UPDATE issue_proposals p
     SET status = 'stale', updated_at = NOW()
   WHERE p.status = 'pending'
     AND p.issue_id IN (
       SELECT i.id FROM analysis_issues i
        WHERE i.repo_id = p_repo_id
          AND NOT (
            i.type::TEXT = ANY(v_preservable_types)
            AND COALESCE(array_length(i.file_paths, 1), 0) > 0
            AND i.file_paths <@ v_unchanged
          )
     );

  -- 2. Count preservable rows (informational, for the indexer log).
  SELECT COUNT(*)::INTEGER INTO v_preserved_count
    FROM analysis_issues i
   WHERE i.repo_id = p_repo_id
     AND i.type::TEXT = ANY(v_preservable_types)
     AND COALESCE(array_length(i.file_paths, 1), 0) > 0
     AND i.file_paths <@ v_unchanged;

  -- 3. Delete non-preservable issues (CASCADE wipes their proposals).
  WITH deleted AS (
    DELETE FROM analysis_issues i
     WHERE i.repo_id = p_repo_id
       AND NOT (
         i.type::TEXT = ANY(v_preservable_types)
         AND COALESCE(array_length(i.file_paths, 1), 0) > 0
         AND i.file_paths <@ v_unchanged
       )
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_deleted_count FROM deleted;

  -- 4. Always-cleared derived tables.
  DELETE FROM dependency_manifests   WHERE repo_id = p_repo_id;
  DELETE FROM graph_edges            WHERE repo_id = p_repo_id;
  DELETE FROM duplication_candidates WHERE repo_id = p_repo_id;

  -- 5. Conditionally clear file_churn (preserved on the incremental webhook path).
  IF NOT p_preserve_churn THEN
    DELETE FROM file_churn WHERE repo_id = p_repo_id;
  END IF;

  -- 6. Reset coverage flags on every graph_node for the repo.
  UPDATE graph_nodes
     SET has_test_coverage   = FALSE,
         coverage_percentage = NULL,
         is_test_file        = FALSE
   WHERE repo_id = p_repo_id;

  -- 7. Partial clear: drop nodes/chunks/file_contents for changed-or-deleted
  --    files only. Unchanged files keep their rows so the indexer can reuse
  --    their parsed state.
  IF COALESCE(array_length(v_changed_deleted, 1), 0) > 0 THEN
    DELETE FROM graph_nodes
     WHERE repo_id = p_repo_id
       AND file_path = ANY(v_changed_deleted);
    DELETE FROM code_chunks
     WHERE repo_id = p_repo_id
       AND file_path = ANY(v_changed_deleted);
    DELETE FROM file_contents
     WHERE repo_id = p_repo_id
       AND file_path = ANY(v_changed_deleted);
  END IF;

  RETURN QUERY SELECT v_preserved_count, v_deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION prepare_repo_reindex(UUID, TEXT[], TEXT[], BOOLEAN) TO service_role;

-- =============================================================================
-- Phase 2.2: bulk_insert_analysis_issues
-- Single insert call instead of chunked-500 inserts from JS. Also moves the
-- type/file_paths shape check into SQL so a malformed row doesn't slip in.
-- =============================================================================

CREATE OR REPLACE FUNCTION bulk_insert_analysis_issues(
  p_repo_id UUID,
  p_issues  JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  IF p_issues IS NULL OR jsonb_array_length(p_issues) = 0 THEN
    RETURN 0;
  END IF;

  WITH src AS (
    SELECT
      NULLIF(item->>'type', '')             AS type_text,
      NULLIF(item->>'severity', '')         AS severity,
      ARRAY(
        SELECT jsonb_array_elements_text(COALESCE(item->'file_paths', '[]'::jsonb))
      )                                     AS file_paths,
      NULLIF(item->>'description', '')      AS description
    FROM jsonb_array_elements(p_issues) AS item
  ),
  filtered AS (
    SELECT * FROM src
     WHERE type_text IS NOT NULL
       AND array_length(file_paths, 1) > 0
  ),
  inserted AS (
    INSERT INTO analysis_issues (id, repo_id, type, severity, file_paths, description)
    SELECT gen_random_uuid(), p_repo_id, type_text::issue_type, severity, file_paths, description
      FROM filtered
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_inserted FROM inserted;

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_insert_analysis_issues(UUID, JSONB) TO service_role;

-- =============================================================================
-- Phase 3: api_usage daily rollup
-- aiRateLimit reads the rolling 24h token total on every AI request. As
-- api_usage grows, the full-window scan gets expensive. A trigger-maintained
-- (user_id, day) rollup keeps the rate-limit check at O(1) regardless of
-- per-user request volume.
-- =============================================================================

CREATE TABLE IF NOT EXISTS api_usage_daily (
  user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date        DATE        NOT NULL,
  prompt_tokens     BIGINT      NOT NULL DEFAULT 0,
  completion_tokens BIGINT      NOT NULL DEFAULT 0,
  embedding_tokens  BIGINT      NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS api_usage_daily_user_date_idx
  ON api_usage_daily (user_id, usage_date DESC);

ALTER TABLE api_usage_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_usage_daily owner-read" ON api_usage_daily;
CREATE POLICY "api_usage_daily owner-read"
  ON api_usage_daily FOR SELECT
  USING (auth.uid() = user_id);

-- Trigger: keep api_usage_daily in sync inside the same transaction as the
-- api_usage insert. Using NEW.created_at (not NOW()) so backfills and tests
-- aggregate into the correct day.
CREATE OR REPLACE FUNCTION rollup_api_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO api_usage_daily (
    user_id, usage_date, prompt_tokens, completion_tokens, embedding_tokens, updated_at
  )
  VALUES (
    NEW.user_id,
    (NEW.created_at AT TIME ZONE 'UTC')::DATE,
    COALESCE(NEW.prompt_tokens, 0),
    COALESCE(NEW.completion_tokens, 0),
    COALESCE(NEW.embedding_tokens, 0),
    NOW()
  )
  ON CONFLICT (user_id, usage_date) DO UPDATE
    SET prompt_tokens     = api_usage_daily.prompt_tokens     + EXCLUDED.prompt_tokens,
        completion_tokens = api_usage_daily.completion_tokens + EXCLUDED.completion_tokens,
        embedding_tokens  = api_usage_daily.embedding_tokens  + EXCLUDED.embedding_tokens,
        updated_at        = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS api_usage_rollup_trigger ON api_usage;
CREATE TRIGGER api_usage_rollup_trigger
  AFTER INSERT ON api_usage
  FOR EACH ROW EXECUTE FUNCTION rollup_api_usage();

-- One-time backfill (safe to re-run; ON CONFLICT keeps it idempotent and the
-- WHERE clause restricts to rows missing in the rollup).
INSERT INTO api_usage_daily (user_id, usage_date, prompt_tokens, completion_tokens, embedding_tokens, updated_at)
SELECT
  u.user_id,
  (u.created_at AT TIME ZONE 'UTC')::DATE AS usage_date,
  SUM(COALESCE(u.prompt_tokens, 0))::BIGINT,
  SUM(COALESCE(u.completion_tokens, 0))::BIGINT,
  SUM(COALESCE(u.embedding_tokens, 0))::BIGINT,
  NOW()
FROM api_usage u
GROUP BY u.user_id, (u.created_at AT TIME ZONE 'UTC')::DATE
ON CONFLICT (user_id, usage_date) DO NOTHING;

-- =============================================================================
-- Phase 5.2: embedding_cache
-- OpenAI embeddings cost real money. Identical chunks across repos (shared
-- library code, copied components) get re-embedded otherwise. content_hash is
-- a SHA-256 of the chunk text; last_used_at supports a manual eviction job.
-- =============================================================================

CREATE TABLE IF NOT EXISTS embedding_cache (
  content_hash  TEXT         PRIMARY KEY,
  embedding     vector(1536) NOT NULL,
  token_count   INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS embedding_cache_last_used_idx
  ON embedding_cache (last_used_at);

-- Service role only; embedding_cache has no per-user notion and lookups always
-- go through trusted backend code.
ALTER TABLE embedding_cache ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Phase 6: index audit
-- These indexes were identified as candidates after Phase 0 profiling. They
-- back the proposal-context graph lookups and issue-type filtering. All are
-- IF NOT EXISTS so the schema remains idempotent.
-- =============================================================================

CREATE INDEX IF NOT EXISTS graph_edges_repo_from_idx
  ON graph_edges (repo_id, from_path);

CREATE INDEX IF NOT EXISTS graph_edges_repo_to_idx
  ON graph_edges (repo_id, to_path);

CREATE INDEX IF NOT EXISTS analysis_issues_repo_type_idx
  ON analysis_issues (repo_id, type);

CREATE INDEX IF NOT EXISTS issue_proposals_issue_user_status_idx
  ON issue_proposals (issue_id, user_id, status, created_at DESC);

-- US-075: proposals generated from PR review findings. These intentionally do
-- not reference analysis_issues because PR findings can exist only inside a
-- persisted pr_reviews.findings_json payload.
CREATE TABLE IF NOT EXISTS pr_finding_proposals (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id         UUID            NOT NULL REFERENCES pr_reviews(id) ON DELETE CASCADE,
  finding_id        TEXT            NOT NULL,
  user_id           UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status            proposal_status NOT NULL DEFAULT 'pending',
  proposal_json     JSONB           NOT NULL,
  branch_name       TEXT,
  pr_url            TEXT,
  prompt_tokens     INTEGER         NOT NULL DEFAULT 0,
  completion_tokens INTEGER         NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pr_finding_proposals_review_finding_created_idx
  ON pr_finding_proposals (review_id, finding_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pr_finding_proposals_user_created_idx
  ON pr_finding_proposals (user_id, created_at DESC);

ALTER TABLE pr_finding_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access only their own PR finding proposals" ON pr_finding_proposals;
CREATE POLICY "Users access only their own PR finding proposals"
  ON pr_finding_proposals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS pr_finding_proposals_set_updated_at ON pr_finding_proposals;
CREATE TRIGGER pr_finding_proposals_set_updated_at
  BEFORE UPDATE ON pr_finding_proposals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- US-067: AI Repo Agent — conversation persistence
-- content_json is polymorphic by role:
--   role = 'user' | 'assistant'  → { text: string }
--   role = 'tool_use'            → { tool_name: string, input: object, tool_use_id: string }
--   role = 'tool_result'         → { tool_use_id: string, output: any, is_error: boolean }
-- tool_use_id matches the Anthropic protocol id so the trace can be replayed verbatim.
-- =============================================================================

DO $$ BEGIN
  CREATE TYPE agent_message_role AS ENUM ('user', 'assistant', 'tool_use', 'tool_result');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS agent_conversations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id       UUID        NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  title         TEXT,
  total_tokens  INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_conversations_user_repo_updated_idx
  ON agent_conversations (user_id, repo_id, updated_at DESC);

ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access their own conversations" ON agent_conversations;
CREATE POLICY "Users access their own conversations"
  ON agent_conversations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS agent_conversations_set_updated_at ON agent_conversations;
CREATE TRIGGER agent_conversations_set_updated_at
  BEFORE UPDATE ON agent_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS agent_messages (
  id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID                NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role            agent_message_role  NOT NULL,
  content_json    JSONB               NOT NULL,
  token_usage     JSONB,
  created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_messages_conv_created_idx
  ON agent_messages (conversation_id, created_at);

ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access messages of their conversations" ON agent_messages;
CREATE POLICY "Users access messages of their conversations"
  ON agent_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM agent_conversations c
                  WHERE c.id = agent_messages.conversation_id
                    AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM agent_conversations c
                       WHERE c.id = agent_messages.conversation_id
                         AND c.user_id = auth.uid()));

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
