/**
 * Tours controller — Tour generation via RAG + graph BFS walk (US-055)
 */

const { OpenAI }        = require('openai');
const Anthropic         = require('@anthropic-ai/sdk');
const { supabaseAdmin } = require('../db/supabase');
const { recordUsage }   = require('../services/usageTracker');

const MODEL = 'claude-sonnet-4-20250514';
const MAX_DAILY_TOKENS = parseInt(process.env.MAX_DAILY_TOKENS_PER_USER || '500000', 10);
const DISTANCE_THRESHOLD = 0.4;
const MAX_STEPS = 8;

const _openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-dummy' });
const _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy' });
function _proxy(real, key) {
  return new Proxy(real, { get(_t, p) { const a = globalThis[key] || real; const v = a[p]; return typeof v === 'function' ? v.bind(a) : v; } });
}
const openai    = _proxy(_openai,    '__CODELENS_OPENAI__');
const anthropic = _proxy(_anthropic, '__CODELENS_ANTHROPIC__');

async function canAccessRepo(repoId, userId) {
  const { data: owned } = await supabaseAdmin
    .from('repositories')
    .select('id')
    .eq('id', repoId)
    .eq('user_id', userId)
    .maybeSingle();
  if (owned) return true;

  const { data: memberships } = await supabaseAdmin
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId);
  const teamIds = (memberships || []).map((m) => m.team_id);
  if (teamIds.length === 0) return false;

  const { data: teamRepo } = await supabaseAdmin
    .from('team_repositories')
    .select('repo_id')
    .eq('repo_id', repoId)
    .in('team_id', teamIds)
    .maybeSingle();

  return !!teamRepo;
}

async function dailyTokensUsed(userId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('api_usage')
    .select('prompt_tokens, completion_tokens, embedding_tokens')
    .eq('user_id', userId)
    .gte('created_at', since);
  if (error) return 0;
  return (data || []).reduce(
    (sum, row) => sum + (row.prompt_tokens || 0) + (row.completion_tokens || 0) + (row.embedding_tokens || 0),
    0
  );
}

const generateTour = async (req, res) => {
  const { repoId } = req.params;
  const { query, save = false } = req.body;
  const userId = req.user.id;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'query is required' });
  }

  if (!(await canAccessRepo(repoId, userId))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Pre-flight token budget check
  if ((await dailyTokensUsed(userId)) >= MAX_DAILY_TOKENS) {
    return res.status(429).json({ error: 'Daily token budget exhausted' });
  }

  // 1. Embed query
  const embedRes = await openai.embeddings.create({ model: 'text-embedding-3-small', input: query.trim() });
  const embedding = embedRes.data[0].embedding;
  const embedTokens = embedRes.usage?.total_tokens || 0;
  await recordUsage({ userId, endpoint: 'tour-generate', provider: 'openai', embeddingTokens: embedTokens });

  // 2. RAG retrieval — top 20 chunks
  const vectorLiteral = `[${embedding.join(',')}]`;
  const { data: chunks, error: rpcErr } = await supabaseAdmin.rpc('match_code_chunks', {
    p_repo_id:   repoId,
    p_embedding: vectorLiteral,
    p_top_k:     20,
  });
  if (rpcErr) {
    console.warn('[tour] match_code_chunks RPC failed:', rpcErr.message);
    return res.status(500).json({ error: 'Vector search failed' });
  }

  // 3. Filter by distance threshold
  const relevant = (chunks || []).filter((c) => c.distance <= DISTANCE_THRESHOLD);
  if (relevant.length === 0) {
    return res.status(404).json({ error: 'No relevant code found for that query' });
  }

  // 4. Build relevantSet: filePath → { chunks (sorted by distance asc), minDist }
  const relevantSet = new Map();
  for (const chunk of relevant) {
    if (!relevantSet.has(chunk.file_path)) {
      relevantSet.set(chunk.file_path, { chunks: [], minDist: chunk.distance });
    }
    const entry = relevantSet.get(chunk.file_path);
    entry.chunks.push(chunk);
    if (chunk.distance < entry.minDist) entry.minDist = chunk.distance;
  }
  for (const entry of relevantSet.values()) {
    entry.chunks.sort((a, b) => a.distance - b.distance);
  }

  // 5. Find start file
  const relevantPaths = Array.from(relevantSet.keys());
  const { data: nodes } = await supabaseAdmin
    .from('graph_nodes')
    .select('file_path, incoming_count, node_classification')
    .eq('repo_id', repoId)
    .in('file_path', relevantPaths);

  let startFile = relevantPaths[0];
  if (nodes && nodes.length > 0) {
    const sources = nodes.filter((n) => n.node_classification === 'source' || n.node_classification === 'both');
    const pool = sources.length > 0 ? sources : nodes;
    pool.sort((a, b) => (b.incoming_count || 0) - (a.incoming_count || 0));
    startFile = pool[0].file_path;
  }

  // 6. BFS graph walk
  const { data: edges } = await supabaseAdmin
    .from('graph_edges')
    .select('from_path, to_path')
    .eq('repo_id', repoId);

  const adjacency = new Map();
  for (const edge of edges || []) {
    if (!adjacency.has(edge.from_path)) adjacency.set(edge.from_path, []);
    adjacency.get(edge.from_path).push(edge.to_path);
  }

  const visited = new Set([startFile]);
  const result  = [startFile];
  const queue   = [startFile];

  while (queue.length && result.length < MAX_STEPS) {
    const current   = queue.shift();
    const neighbors = adjacency.get(current) || [];

    // Prefer neighbors in the relevant set, sorted by relevance score (minDist asc = more relevant)
    const inRelevant = neighbors
      .filter((n) => relevantSet.has(n) && !visited.has(n))
      .sort((a, b) => relevantSet.get(a).minDist - relevantSet.get(b).minDist);

    // Also take one non-relevant neighbor to allow traversal through connector files
    const outOfRelevant = neighbors.filter((n) => !relevantSet.has(n) && !visited.has(n)).slice(0, 1);

    for (const n of [...inRelevant, ...outOfRelevant]) {
      if (!visited.has(n) && result.length < MAX_STEPS) {
        visited.add(n);
        result.push(n);
        queue.push(n);
      }
    }
  }

  // 7. Generate Claude explanation for each step
  const steps = [];
  for (let i = 0; i < result.length; i++) {
    const filePath = result[i];

    // Per-step budget check
    if ((await dailyTokensUsed(userId)) >= MAX_DAILY_TOKENS) {
      console.warn(`[tour] daily token budget exhausted at step ${i + 1}/${result.length}`);
      break;
    }

    // Best chunk for this file
    const fileEntry = relevantSet.get(filePath);
    let excerpt = '';
    let startLine = null;
    let endLine = null;

    if (fileEntry) {
      const best = fileEntry.chunks[0];
      excerpt   = best.content;
      startLine = best.start_line;
      endLine   = best.end_line;
    } else {
      // File reached via graph traversal but not in relevant set — fetch first chunk
      const { data: fallbackChunks } = await supabaseAdmin
        .from('code_chunks')
        .select('content, start_line, end_line')
        .eq('repo_id', repoId)
        .eq('file_path', filePath)
        .order('start_line', { ascending: true })
        .limit(1);
      if (fallbackChunks && fallbackChunks.length > 0) {
        excerpt   = fallbackChunks[0].content;
        startLine = fallbackChunks[0].start_line;
        endLine   = fallbackChunks[0].end_line;
      }
    }

    const previousTitles = result.slice(0, i).join(', ') || 'none yet';

    const userPrompt =
      `You are writing one step of a guided tour through a codebase. The user asked: '${query}'. ` +
      `The tour so far has covered: ${previousTitles}. ` +
      `The current step is the file \`${filePath}\`. Here's the relevant excerpt:\n\n${excerpt}\n\n` +
      `Write 2–4 sentences explaining what role this file plays in answering the user's question. ` +
      `Do not summarise the whole file — focus on its role in this specific flow.`;

    console.log(`[tour] step ${i + 1}/${result.length}: ${filePath}`);

    let explanation = '';
    try {
      const response = await anthropic.messages.create({
        model:     MODEL,
        max_tokens: 300,
        system:    'You are a senior software engineer writing clear, concise guided tour steps for developers exploring an unfamiliar codebase.',
        messages:  [{ role: 'user', content: userPrompt }],
      });
      explanation = response.content[0]?.type === 'text' ? response.content[0].text : '';
      await recordUsage({
        userId,
        endpoint:         'tour-generate',
        provider:         'anthropic',
        promptTokens:     response.usage?.input_tokens  || 0,
        completionTokens: response.usage?.output_tokens || 0,
      });
    } catch (err) {
      console.error(`[tour] Claude call failed at step ${i + 1}:`, err.message);
      explanation = '';
    }

    steps.push({ file_path: filePath, start_line: startLine, end_line: endLine, explanation });
  }

  // 8. Optionally persist
  if (save) {
    const title = query.length > 80 ? query.slice(0, 77) + '…' : query;

    const { data: tour, error: tourErr } = await supabaseAdmin
      .from('tours')
      .insert({
        repo_id:           repoId,
        created_by:        userId,
        title,
        original_query:    query,
        is_auto_generated: false,
        is_team_shared:    false,
      })
      .select()
      .single();

    if (tourErr) {
      return res.status(500).json({ error: 'Failed to save tour', detail: tourErr.message });
    }

    const stepRows = steps.map((s, idx) => ({
      tour_id:    tour.id,
      step_order: idx + 1,
      file_path:  s.file_path,
      start_line: s.start_line,
      end_line:   s.end_line,
      explanation: s.explanation,
    }));

    const { error: stepsErr } = await supabaseAdmin.from('tour_steps').insert(stepRows);
    if (stepsErr) {
      console.error('[tour] Failed to insert tour steps:', stepsErr.message);
    }

    return res.json({ tour, steps });
  }

  return res.json({ steps });
};

module.exports = { generateTour };
