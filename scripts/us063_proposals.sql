-- US-063: AI refactor proposals
-- US-064: per-importer symbol tracking on graph_edges
--
-- Idempotent — safe to re-run. Apply this in addition to scripts/schema.sql
-- (the same blocks are appended there so schema.sql stays a single source of truth).

-- ─── graph_edges.symbols (US-064) ─────────────────────────────────────────────
ALTER TABLE graph_edges ADD COLUMN IF NOT EXISTS symbols TEXT[] NOT NULL DEFAULT '{}';

-- ─── proposal status enum ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE proposal_status AS ENUM ('pending', 'applied', 'discarded', 'stale');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── issue_proposals table ────────────────────────────────────────────────────
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

-- Re-uses the set_updated_at() trigger function defined in schema.sql (US-054).
DROP TRIGGER IF EXISTS issue_proposals_set_updated_at ON issue_proposals;
CREATE TRIGGER issue_proposals_set_updated_at
  BEFORE UPDATE ON issue_proposals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
