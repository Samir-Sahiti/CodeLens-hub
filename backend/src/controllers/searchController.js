/**
 * Search controller — RAG pipeline (US-018 / US-019)
 *
 * POST /api/search/:repoId
 *   Body:  { query: string }
 *   Auth:  requireAuth middleware attaches req.user
 *
 * Pipeline:
 *   1. Embed query   (OpenAI text-embedding-3-small)
 *   2. Vector search (pgvector cosine similarity over code_chunks)
 *   3. Guard clause  (if best match is too far, return graceful fallback)
 *   4. Build prompt  (system + user with retrieved context)
 *   5. Stream answer (Anthropic Claude)
 *   6. Return        { answer, sources[] } or stream depending on client
 */

const { OpenAI }     = require('openai');
const Anthropic      = require('@anthropic-ai/sdk');
const { supabaseAdmin } = require('../db/supabase');

const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Embed a single query string with OpenAI text-embedding-3-small.
 * Returns a Float32Array-compatible JS array (1536 dims).
 */
async function embedQuery(query) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  return res.data[0].embedding;
}

/**
 * Retrieve the top-k most similar code chunks from Supabase using pgvector.
 * Returns rows from code_chunks ordered by cosine distance ascending.
 */
async function retrieveChunks(repoId, embedding, topK = 8) {
  // pgvector cosine distance operator: <=>
  // Lower = more similar. We cast the JS array to the postgres vector type.
  const vectorLiteral = `[${embedding.join(',')}]`;

  const { data, error } = await supabaseAdmin.rpc('match_code_chunks', {
    p_repo_id:   repoId,
    p_embedding: vectorLiteral,
    p_top_k:     topK,
  });

  if (error) {
    // Fallback: plain SELECT without vector ordering if the RPC doesn't exist yet.
    // This lets developers test the panel even before the SQL function is deployed.
    console.warn('[search] match_code_chunks RPC failed, using plain fallback:', error.message);
    const { data: fallback, error: fallbackErr } = await supabaseAdmin
      .from('code_chunks')
      .select('file_path, start_line, end_line, content')
      .eq('repo_id', repoId)
      .limit(topK);

    if (fallbackErr) throw new Error(`Vector search failed: ${fallbackErr.message}`);
    return (fallback || []).map(r => ({ ...r, distance: 0.5 }));
  }

  return data || [];
}

/**
 * Build the Claude system + user prompt from retrieved chunks.
 */
function buildPrompt(query, chunks) {
  const contextBlocks = chunks.map(chunk => {
    const header = `--- ${chunk.file_path} (lines ${chunk.start_line}–${chunk.end_line}) ---`;
    return `${header}\n${chunk.content}`;
  }).join('\n\n');

  const system = [
    'You are a senior software engineer helping a developer understand their codebase.',
    'Answer the user\'s question using ONLY the code excerpts provided below.',
    'Always reference the file path and line numbers when you cite code.',
    'Format code references like: `path/to/file.ts` (lines 12–34).',
    'When showing code, use markdown fenced code blocks with the correct language tag.',
    'If the answer is not clearly supported by the provided excerpts, say so honestly — do not guess.',
    'Keep your answer concise and developer-focused.',
  ].join(' ');

  const user = `Question: ${query}\n\nCode context:\n\n${contextBlocks}`;

  return { system, user };
}

/**
 * Format a chunk into the sources array for the response.
 */
function formatSource(chunk) {
  const lines = (chunk.content || '').split('\n');
  const excerpt = lines.slice(0, 2).join('\n');
  return {
    file_path:  chunk.file_path,
    start_line: chunk.start_line,
    end_line:   chunk.end_line,
    excerpt,
    full_content: chunk.content,
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * POST /api/search/:repoId
 * Streams the answer back as Server-Sent Events (text/event-stream).
 * Events:
 *   data: { type: "sources", sources: [...] }   — sent first, immediately
 *   data: { type: "chunk",   text: "..." }       — streaming answer tokens
 *   data: { type: "done" }                        — stream finished
 *   data: { type: "error",  message: "..." }      — on any failure
 */
const search = async (req, res) => {
  const { repoId } = req.params;
  const { query }  = req.body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'query is required' });
  }

  // Verify the repo belongs to the requesting user
  const { data: repo, error: repoErr } = await supabaseAdmin
    .from('repositories')
    .select('id, status')
    .eq('id', repoId)
    .eq('user_id', req.user.id)
    .single();

  if (repoErr || !repo) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  // --- Set up SSE stream ---
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present
  res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // 10-second pipeline timeout to meet the <10s acceptance criterion
  const PIPELINE_TIMEOUT_MS = 10000;
  const pipelineStart = Date.now();
  let pipelineTimedOut = false;

  const timeoutId = setTimeout(() => {
    pipelineTimedOut = true;
    try {
      send({ type: 'error', message: 'Search timed out. The query took longer than 10 seconds. Try a shorter or more specific question.' });
      res.end();
    } catch { /* stream may already be closed */ }
  }, PIPELINE_TIMEOUT_MS);

  try {
    // 1. Check API keys
    if (!process.env.OPENAI_API_KEY) {
      clearTimeout(timeoutId);
      send({ type: 'error', message: 'Search is not available: OpenAI API key not configured.' });
      return res.end();
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      clearTimeout(timeoutId);
      send({ type: 'error', message: 'Search is not available: Anthropic API key not configured.' });
      return res.end();
    }

    // 2. Embed the query
    const embedStart = Date.now();
    let embedding;
    try {
      embedding = await embedQuery(query.trim());
    } catch (err) {
      clearTimeout(timeoutId);
      send({ type: 'error', message: 'Failed to process your query. Please try again.' });
      return res.end();
    }
    console.log(`[search] Embedding took ${Date.now() - embedStart}ms`);
    if (pipelineTimedOut) return;

    // 3. Vector similarity search
    const searchStart = Date.now();
    let chunks;
    try {
      chunks = await retrieveChunks(repoId, embedding, 8);
    } catch (err) {
      clearTimeout(timeoutId);
      send({ type: 'error', message: 'Failed to search the codebase index. Please try again.' });
      return res.end();
    }
    console.log(`[search] Vector search took ${Date.now() - searchStart}ms, returned ${(chunks || []).length} chunks`);
    if (pipelineTimedOut) return;

    // 4. Guard: if no chunks at all, return graceful fallback
    if (!chunks || chunks.length === 0) {
      clearTimeout(timeoutId);
      send({ type: 'sources', sources: [] });
      send({ type: 'chunk', text: "I couldn't find any indexed code for this repository. The repository may not have been fully embedded yet — try re-indexing it." });
      send({ type: 'done' });
      return res.end();
    }

    // 5. Guard: if best match cosine distance > 0.4, no relevant code found
    const bestDistance = chunks[0]?.distance ?? 0;
    if (bestDistance > 0.4 && chunks[0]?.distance !== undefined) {
      clearTimeout(timeoutId);
      send({ type: 'sources', sources: [] });
      send({ type: 'chunk', text: "I couldn't find relevant code for that question in this repository. Try rephrasing your question or asking about a specific file or feature." });
      send({ type: 'done' });
      return res.end();
    }

    // 5b. Context size guard — trim chunks if combined content exceeds 12,000 chars
    const MAX_CONTEXT_CHARS = 12000;
    let totalChars = 0;
    const trimmedChunks = [];
    for (const chunk of chunks) {
      const chunkLen = (chunk.content || '').length;
      if (totalChars + chunkLen > MAX_CONTEXT_CHARS && trimmedChunks.length > 0) {
        break; // Already have some context, stop adding more
      }
      trimmedChunks.push(chunk);
      totalChars += chunkLen;
    }

    // 6. Send sources immediately (up to 5)
    const sources = trimmedChunks.slice(0, 5).map(formatSource);
    send({ type: 'sources', sources });

    // 7. Build Claude prompt
    const { system, user } = buildPrompt(query.trim(), trimmedChunks);

    // 8. Stream Claude response
    const llmStart = Date.now();
    const stream = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system,
      messages:   [{ role: 'user', content: user }],
      stream:     true,
    });

    for await (const event of stream) {
      if (pipelineTimedOut) break;
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        send({ type: 'chunk', text: event.delta.text });
      }
    }

    clearTimeout(timeoutId);
    if (!pipelineTimedOut) {
      console.log(`[search] LLM streaming took ${Date.now() - llmStart}ms, total pipeline ${Date.now() - pipelineStart}ms`);
      send({ type: 'done' });
      res.end();
    }

  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[search] Unhandled error:', err);
    try {
      send({ type: 'error', message: 'An unexpected error occurred. Please try again.' });
      res.end();
    } catch {
      res.end();
    }
  }
};

module.exports = { search };