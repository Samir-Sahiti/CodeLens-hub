-- Fix: duplicate match_code_chunks overloads break PostgREST RPC resolution.
--
-- Symptom: PGRST203 "Could not choose the best candidate function between
--   public.match_code_chunks(uuid, vector, integer) and
--   public.match_code_chunks(uuid, text, integer)".
--
-- Effect: every RAG caller (search, review, agent, tours) fails the RPC. Most
-- silently fall back to a non-vector plain SELECT and return junk; tours has no
-- fallback so it surfaces "Vector search failed".
--
-- A stale `text`-parameter overload was left in the live DB by an earlier
-- deploy. Drop BOTH known signatures, then recreate the single canonical
-- vector(1536) version (identical to scripts/schema.sql). Idempotent.

DROP FUNCTION IF EXISTS public.match_code_chunks(uuid, text, integer);
DROP FUNCTION IF EXISTS public.match_code_chunks(uuid, vector, integer);
DROP FUNCTION IF EXISTS public.match_code_chunks(uuid, extensions.vector, integer);

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
