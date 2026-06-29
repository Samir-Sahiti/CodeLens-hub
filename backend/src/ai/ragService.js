/**
 * RAG service — embedding + vector retrieval over the indexed code_chunks.
 *
 * Used by:
 *   - searchController (US-018 / US-019)  — embeds the user query and feeds
 *     chunks into the LLM for synthesis.
 *   - agentTools.search_code (US-068) — returns raw chunks (no synthesis).
 *
 * The OpenAI client is shared from ./openaiClient (Proxy-wrapped so tests can
 * stub `globalThis.__CODELENS_OPENAI__`).
 */

const { supabaseAdmin } = require('../db/supabase');
const { openai } = require('./openaiClient');
const { SAFE_FETCH_CEILING, warnIfCeilingHit } = require('../lib/dbHelpers');

/**
 * Embed a natural language query. Returns `{ embedding, tokens }`.
 * Throws if the OpenAI key is missing or the API fails.
 */
async function embedQuery(query) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query.trim(),
  });
  return {
    embedding: res.data[0].embedding,
    tokens: res.usage?.total_tokens || 0,
  };
}

/**
 * Parse a pgvector embedding as returned by PostgREST. The column comes back
 * either as the textual literal "[0.1,0.2,...]" or, depending on the client,
 * an already-parsed number[]. Returns a number[] or null if it can't be parsed.
 */
function parseStoredEmbedding(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.length > 1) {
    try {
      const arr = JSON.parse(value);
      return Array.isArray(arr) ? arr : null;
    } catch { return null; }
  }
  return null;
}

/** Cosine distance (1 − cosine similarity), matching pgvector's `<=>` operator. */
function cosineDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Degraded-path retrieval: the pgvector RPC is unavailable, so rank in-process
 * by actually computing cosine distance over the stored embeddings instead of
 * returning arbitrary unranked chunks. Results are genuinely relevant (not
 * junk) and every row is stamped `degraded: true` so callers and monitoring can
 * tell retrieval ran without the index. Bounded by SAFE_FETCH_CEILING — on a
 * repo larger than the ceiling the ranking covers a prefix, which is logged.
 */
async function fallbackCosineRank(repoId, queryEmbedding, topK) {
  const { data, error } = await supabaseAdmin
    .from('code_chunks')
    .select('file_path, start_line, end_line, content, embedding')
    .eq('repo_id', repoId)
    .range(0, SAFE_FETCH_CEILING - 1);
  if (error) throw new Error(`Vector search failed (fallback): ${error.message}`);
  const rows = data || [];
  warnIfCeilingHit('ragService.fallbackCosineRank code_chunks', rows);

  const scored = rows.map((r) => {
    const { embedding, ...rest } = r;
    const stored = parseStoredEmbedding(embedding);
    return { ...rest, distance: cosineDistance(queryEmbedding, stored), degraded: true };
  });
  scored.sort((a, b) => a.distance - b.distance);
  return scored.slice(0, topK);
}

/**
 * Retrieve top-k code chunks by cosine similarity via the pgvector RPC.
 *
 * If the RPC fails (most often a broken/duplicate `match_code_chunks` overload —
 * PGRST203 — or, in local dev, a missing migration) we do NOT silently return
 * arbitrary chunks: that produces confident, wrong answers with no signal.
 * Instead we log loudly and fall back to a real in-process cosine ranking, with
 * every row flagged `degraded: true`.
 */
async function retrieveChunks(repoId, embedding, topK = 8) {
  const vectorLiteral = `[${embedding.join(',')}]`;
  const { data, error } = await supabaseAdmin.rpc('match_code_chunks', {
    p_repo_id: repoId,
    p_embedding: vectorLiteral,
    p_top_k: topK,
  });
  if (error) {
    // console.error (not warn): in production this is a real outage of the
    // vector index, not an expected condition — it must be visible in logs.
    console.error('[ragService] match_code_chunks RPC failed — falling back to in-process cosine ranking:', error.message);
    return fallbackCosineRank(repoId, embedding, topK);
  }
  return data || [];
}

module.exports = { embedQuery, retrieveChunks, _private: { parseStoredEmbedding, cosineDistance, fallbackCosineRank } };
