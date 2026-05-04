-- US-051: Architectural diff cache
-- Apply via Supabase SQL Editor

CREATE TABLE IF NOT EXISTS diff_cache (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id     UUID        NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  base_sha    TEXT        NOT NULL,
  head_sha    TEXT        NOT NULL,
  base_ref    TEXT        NOT NULL,
  head_ref    TEXT        NOT NULL,
  result_json JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (repo_id, base_sha, head_sha)
);

-- Auto-expire entries older than 7 days to prevent unbounded growth.
-- A cron job or pg_cron extension can run this; for now it is left as a
-- reference for ops to schedule manually.
-- DELETE FROM diff_cache WHERE created_at < NOW() - INTERVAL '7 days';

ALTER TABLE diff_cache ENABLE ROW LEVEL SECURITY;

-- Repo owners can read their own diff cache.
-- Writes go through supabaseAdmin (service role) which bypasses RLS, so
-- we restrict the client-facing policy to SELECT only to prevent cache poisoning.
CREATE POLICY "owner can read diff_cache"
  ON diff_cache FOR SELECT
  USING (
    repo_id IN (
      SELECT id FROM repositories WHERE user_id = auth.uid()
    )
  );

-- Team members can read diff cache for repos shared with their teams
CREATE POLICY "team member can read diff_cache"
  ON diff_cache FOR SELECT
  USING (
    repo_id IN (
      SELECT tr.repo_id
      FROM team_repositories tr
      INNER JOIN team_members tm ON tm.team_id = tr.team_id
      WHERE tm.user_id = auth.uid()
    )
  );
