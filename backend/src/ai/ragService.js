/**
 * RAG service — embedding + vector retrieval over the indexed code_chunks.
 *
 * Used by:
 *   - searchController (US-018 / US-019)  — embeds the user query and feeds
 *     chunks into Claude for synthesis.
 *   - agentTools.search_code (US-068) — returns raw chunks (no synthesis).
 *
 * The OpenAI client is wrapped in a Proxy so tests can stub
 * `globalThis.__CODELENS_OPENAI__`, matching the convention used by other
 * controllers.
 */

const { OpenAI } = require('openai');
const { supabaseAdmin } = require('../db/supabase');

const _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-dummy' });
function _proxy(real, key) {
  return new Proxy(real, { get(_t, p) { const a = globalThis[key] || real; const v = a[p]; return typeof v === 'function' ? v.bind(a) : v; } });
}
const openai = _proxy(_openai, '__CODELENS_OPENAI__');

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
 * Retrieve top-k code chunks by cosine similarity. Falls back to a plain
 * SELECT if the pgvector RPC is unavailable (e.g. local dev without the
 * migration applied).
 */
async function retrieveChunks(repoId, embedding, topK = 8) {
  const vectorLiteral = `[${embedding.join(',')}]`;
  const { data, error } = await supabaseAdmin.rpc('match_code_chunks', {
    p_repo_id: repoId,
    p_embedding: vectorLiteral,
    p_top_k: topK,
  });
  if (error) {
    console.warn('[ragService] match_code_chunks RPC failed, using plain fallback:', error.message);
    const { data: fallback, error: fallbackErr } = await supabaseAdmin
      .from('code_chunks')
      .select('file_path, start_line, end_line, content')
      .eq('repo_id', repoId)
      .limit(topK);
    if (fallbackErr) throw new Error(`Vector search failed: ${fallbackErr.message}`);
    return (fallback || []).map((r) => ({ ...r, distance: 0.5 }));
  }
  return data || [];
}

module.exports = { embedQuery, retrieveChunks };
