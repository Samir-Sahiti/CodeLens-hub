-- US-052: Code duplication detection via embeddings

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

CREATE OR REPLACE FUNCTION clear_repo_derived_data(p_repo_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM duplication_candidates WHERE repo_id = p_repo_id;
  DELETE FROM code_chunks          WHERE repo_id = p_repo_id;
  DELETE FROM file_contents        WHERE repo_id = p_repo_id;
  DELETE FROM analysis_issues      WHERE repo_id = p_repo_id;
  DELETE FROM graph_edges          WHERE repo_id = p_repo_id;
  DELETE FROM graph_nodes          WHERE repo_id = p_repo_id;
  DELETE FROM dependency_manifests WHERE repo_id = p_repo_id;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_repo_derived_data(UUID) TO service_role;
