-- 1. Add new issue type for secrets
ALTER TYPE issue_type ADD VALUE IF NOT EXISTS 'hardcoded_secret';

-- 2. Create the suppressions table for false positives
CREATE TABLE issue_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  line_number INT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(repo_id, file_path, rule_id, line_number)
);

-- 3. Indexes and Security
CREATE INDEX ON issue_suppressions(repo_id);
ALTER TABLE issue_suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access suppressions for their repos"
  ON issue_suppressions FOR ALL USING (
    EXISTS (
      SELECT 1 FROM repositories
      WHERE repositories.id = issue_suppressions.repo_id
      AND repositories.user_id = auth.uid()
    )
  );
