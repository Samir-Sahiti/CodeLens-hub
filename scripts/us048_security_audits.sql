-- US-048: AI security audit mode

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
