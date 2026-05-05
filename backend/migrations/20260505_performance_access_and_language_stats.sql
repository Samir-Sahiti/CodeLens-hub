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

GRANT EXECUTE ON FUNCTION can_access_repo(UUID, UUID) TO service_role;

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS language_stats JSONB DEFAULT '[]';
