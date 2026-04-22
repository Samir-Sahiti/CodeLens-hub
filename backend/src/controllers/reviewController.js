/**
 * Review controller — AI Code Review (US-026)
 *
 * POST /api/review/:repoId
 *   Body:  { snippet: string, context?: string, mode?: 'review' | 'cleanup' }
 *   Auth:  requireAuth middleware attaches req.user
 *
 * Pipeline:
 *   1. Validate snippet (present, ≤ 200 lines)
 *   2. Verify repo ownership
 *   3. Embed the snippet (OpenAI text-embedding-3-small)
 *   4. Retrieve top 5 similar chunks (pgvector cosine similarity)
 *   5. Send { type: 'sources', sources } event immediately
 *   6. Build prompt based on mode ('review' or 'cleanup')
 *   7. Stream Claude response as { type: 'chunk' } events
 *   8. Send { type: 'done' } when complete
 */

const { OpenAI }        = require('openai');
const Anthropic         = require('@anthropic-ai/sdk');
const { supabaseAdmin } = require('../db/supabase');
const { recordUsage }   = require('../services/usageTracker');

const _openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-dummy' });
const _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy' });
function _proxy(real, key) {
  return new Proxy(real, { get(_t, p) { const a = globalThis[key] || real; const v = a[p]; return typeof v === 'function' ? v.bind(a) : v; } });
}
const openai    = _proxy(_openai,    '__CODELENS_OPENAI__');
const anthropic = _proxy(_anthropic, '__CODELENS_ANTHROPIC__');

// ---------------------------------------------------------------------------
// Helpers — mirrors searchController.js exactly
// ---------------------------------------------------------------------------

/**
 * Retrieve the top-k most similar code chunks from Supabase using pgvector.
 * Same as retrieveChunks in searchController.js.
 */
async function retrieveChunks(repoId, embedding, topK = 5) {
  const vectorLiteral = `[${embedding.join(',')}]`;

  const { data, error } = await supabaseAdmin.rpc('match_code_chunks', {
    p_repo_id:   repoId,
    p_embedding: vectorLiteral,
    p_top_k:     topK,
  });

  if (error) {
    console.warn('[review] match_code_chunks RPC failed, using plain fallback:', error.message);
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
 * Build the Claude system + user prompt based on mode.
 *
 * mode = 'review': assess quality, suggest improvements, note compatibility
 * mode = 'cleanup': rewrite snippet following repo patterns
 */
function buildReviewPrompt(snippet, contextDescription, chunks, mode) {
  const contextBlocks = chunks.map(chunk => {
    const header = `--- ${chunk.file_path} (lines ${chunk.start_line}–${chunk.end_line}) ---`;
    return `${header}\n${chunk.content}`;
  }).join('\n\n');

  let system;

  if (mode === 'cleanup') {
    system = [
      'You are reviewing a code snippet for a developer.',
      'You have context from their existing codebase below.',
      'Rewrite the snippet to follow the patterns, naming conventions, and coding standards you observe in their codebase.',
      'Return ONLY the rewritten code in a fenced code block, followed by a brief explanation of what you changed and why.',
    ].join(' ');
  } else {
    // Default: 'review'
    system = [
      'You are reviewing a code snippet for a developer.',
      'You have context from their existing codebase below.',
      'Assess code quality, suggest improvements, and specifically note whether this code is consistent with the patterns and conventions you see in their codebase.',
    ].join(' ');
  }

  let userContent = `Code snippet to review:\n\`\`\`\n${snippet}\n\`\`\``;

  if (contextDescription && contextDescription.trim()) {
    userContent += `\n\nWhat this code is supposed to do: ${contextDescription.trim()}`;
  }

  if (contextBlocks) {
    userContent += `\n\nExisting codebase context:\n\n${contextBlocks}`;
  }

  return { system, user: userContent };
}

/**
 * Format a chunk into the sources array for the response.
 * Same pattern as searchController.js.
 */
function formatSource(chunk) {
  const lines = (chunk.content || '').split('\n');
  const excerpt = lines.slice(0, 2).join('\n');
  return {
    file_path:    chunk.file_path,
    start_line:   chunk.start_line,
    end_line:     chunk.end_line,
    excerpt,
    full_content: chunk.content,
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * POST /api/review/:repoId
 * Streams the answer back as Server-Sent Events (text/event-stream).
 * Events — identical format to searchController.js:
 *   data: { type: "sources", sources: [...] }   — sent first, immediately
 *   data: { type: "chunk",   text: "..." }       — streaming answer tokens
 *   data: { type: "done" }                        — stream finished
 *   data: { type: "error",  message: "..." }      — on any failure
 */
const review = async (req, res) => {
  const { repoId }                               = req.params;
  const { snippet, context: contextDescription, mode = 'review' } = req.body;

  // Validate snippet
  if (!snippet || typeof snippet !== 'string' || snippet.trim().length === 0) {
    return res.status(400).json({ error: 'snippet is required' });
  }

  const lineCount = snippet.split('\n').length;
  if (lineCount > 200) {
    return res.status(400).json({ error: 'snippet must not exceed 200 lines' });
  }

  // Verify repo ownership — same pattern as searchController.js
  const { data: repo, error: repoErr } = await supabaseAdmin
    .from('repositories')
    .select('id, status')
    .eq('id', repoId)
    .eq('user_id', req.user.id)
    .single();

  if (repoErr || !repo) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  // --- Set up SSE stream — identical to searchController.js ---
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    // 1. Check API keys
    if (!process.env.OPENAI_API_KEY) {
      send({ type: 'error', message: 'Review is not available: OpenAI API key not configured.' });
      return res.end();
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      send({ type: 'error', message: 'Review is not available: Anthropic API key not configured.' });
      return res.end();
    }

    // 2. Embed the snippet
    let embedding;
    let embedTokens = 0;
    try {
      const embedRes = await openai.embeddings.create({ model: 'text-embedding-3-small', input: snippet.trim() });
      embedding   = embedRes.data[0].embedding;
      embedTokens = embedRes.usage?.total_tokens || 0;
    } catch (err) {
      send({ type: 'error', message: 'Failed to process your snippet. Please try again.' });
      return res.end();
    }
    recordUsage({ userId: req.user.id, endpoint: 'review', provider: 'openai', embeddingTokens: embedTokens });

    // 3. Retrieve top 5 similar chunks
    let chunks;
    try {
      chunks = await retrieveChunks(repoId, embedding, 5);
    } catch (err) {
      send({ type: 'error', message: 'Failed to search the codebase index. Please try again.' });
      return res.end();
    }

    // 4. Send sources immediately (top 5)
    const sources = (chunks || []).slice(0, 5).map(formatSource);
    send({ type: 'sources', sources });

    // 5. Build prompt with mode
    const { system, user } = buildReviewPrompt(snippet.trim(), contextDescription, chunks || [], mode);

    // 6. Stream Claude response
    const stream = await anthropic.messages.create({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system,
      messages:   [{ role: 'user', content: user }],
      stream:     true,
    });

    let inputTokens = 0, outputTokens = 0;
    for await (const event of stream) {
      if (event.type === 'message_start') {
        inputTokens = event.message?.usage?.input_tokens || 0;
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage?.output_tokens || 0;
      } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        send({ type: 'chunk', text: event.delta.text });
      }
    }

    recordUsage({ userId: req.user.id, endpoint: 'review', provider: 'anthropic', promptTokens: inputTokens, completionTokens: outputTokens });
    send({ type: 'done' });
    res.end();

  } catch (err) {
    console.error('[review] Unhandled error:', err);
    try {
      send({ type: 'error', message: 'An unexpected error occurred. Please try again.' });
      res.end();
    } catch {
      res.end();
    }
  }
};

module.exports = { review };
