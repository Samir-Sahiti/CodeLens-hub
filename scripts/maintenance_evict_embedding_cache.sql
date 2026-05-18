-- Maintenance: evict stale embedding_cache rows.
--
-- Phase 5.2 caches OpenAI embeddings by chunk content_hash so identical code
-- across repos doesn't pay the embed cost twice. Rows that haven't been
-- referenced in 90 days are unlikely to be reused and just bloat the index.
--
-- Safe to run any time. Re-running has no further effect once stale rows are
-- gone. Active hashes are touched (last_used_at = NOW()) on every cache hit.

DELETE FROM embedding_cache
 WHERE last_used_at < NOW() - INTERVAL '90 days';

-- VACUUM (ANALYZE) embedding_cache;
