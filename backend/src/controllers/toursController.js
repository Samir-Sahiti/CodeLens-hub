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

async function getRepoAccess(repoId, userId) {
  const { data: owned } = await supabaseAdmin
    .from('repositories')
    .select('id')
    .eq('id', repoId)
    .eq('user_id', userId)
    .maybeSingle();

  const { data: memberships } = await supabaseAdmin
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId);
  const teamIds = (memberships || []).map((m) => m.team_id);
  if (teamIds.length === 0) {
    return { isOwner: !!owned, hasTeamAccess: false };
  }

  const { data: teamRepo } = await supabaseAdmin
    .from('team_repositories')
    .select('repo_id')
    .eq('repo_id', repoId)
    .in('team_id', teamIds)
    .maybeSingle();

  return { isOwner: !!owned, hasTeamAccess: !!teamRepo };
}

async function canAccessRepo(repoId, userId) {
  const access = await getRepoAccess(repoId, userId);
  return access.isOwner || access.hasTeamAccess;
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

/**
 * Run a Claude explanation pass over a list of file paths, producing tour step rows.
 * Shared by the public RAG tour endpoint and the Start Here service (US-059).
 *
 * @param {object} args
 * @param {string[]} args.filePaths            Ordered list of files to explain (max length MAX_STEPS)
 * @param {string}   args.repoId
 * @param {string}   args.userId
 * @param {Map}      [args.relevantSet]        Optional file→{chunks,minDist} map (RAG path)
 * @param {(path:string,index:number)=>string} args.buildUserPrompt  Prompt template per file
 * @param {string}   args.systemPrompt
 * @param {number}   [args.maxTokens=300]
 * @returns {Promise<{steps: Array, stoppedEarly: boolean}>}
 */
async function explainSteps({
  filePaths,
  repoId,
  userId,
  relevantSet = new Map(),
  buildUserPrompt,
  systemPrompt,
  maxTokens = 300,
}) {
  // Batch-fetch first chunk for files not already in relevantSet (avoid N+1)
  const fallbackByPath = new Map();
  const nonRelevantPaths = filePaths.filter((p) => !relevantSet.has(p));
  if (nonRelevantPaths.length > 0) {
    const { data: fallbackRows } = await supabaseAdmin
      .from('code_chunks')
      .select('file_path, content, start_line, end_line')
      .eq('repo_id', repoId)
      .in('file_path', nonRelevantPaths)
      .order('start_line', { ascending: true });
    for (const row of fallbackRows || []) {
      if (!fallbackByPath.has(row.file_path)) fallbackByPath.set(row.file_path, row);
    }
  }

  let budgetRemaining = MAX_DAILY_TOKENS - (await dailyTokensUsed(userId));
  const steps = [];
  let stoppedEarly = false;

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i];

    if (budgetRemaining <= 0) {
      console.warn(`[tour] daily token budget exhausted at step ${i + 1}/${filePaths.length}`);
      stoppedEarly = true;
      break;
    }

    let excerpt   = '';
    let startLine = null;
    let endLine   = null;

    const fileEntry = relevantSet.get(filePath);
    if (fileEntry) {
      const best = fileEntry.chunks[0];
      excerpt   = best.content;
      startLine = best.start_line;
      endLine   = best.end_line;
    } else {
      const fallback = fallbackByPath.get(filePath);
      if (fallback) {
        excerpt   = fallback.content;
        startLine = fallback.start_line;
        endLine   = fallback.end_line;
      }
    }

    const userPrompt = buildUserPrompt({ filePath, index: i, excerpt, total: filePaths.length });
    console.log(`[tour] step ${i + 1}/${filePaths.length}: ${filePath}`);

    let explanation = '';
    try {
      const response = await anthropic.messages.create({
        model:      MODEL,
        max_tokens: maxTokens,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      });
      explanation = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const inputTokens  = response.usage?.input_tokens  || 0;
      const outputTokens = response.usage?.output_tokens || 0;
      budgetRemaining -= inputTokens + outputTokens;
      await recordUsage({
        userId,
        endpoint:         'tour-generate',
        provider:         'anthropic',
        promptTokens:     inputTokens,
        completionTokens: outputTokens,
      });
    } catch (err) {
      console.error(`[tour] Claude call failed at step ${i + 1}:`, err.message);
      explanation = '';
    }

    steps.push({ file_path: filePath, start_line: startLine, end_line: endLine, explanation });
  }

  return { steps, stoppedEarly };
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
  const { steps } = await explainSteps({
    filePaths:    result,
    repoId,
    userId,
    relevantSet,
    systemPrompt: 'You are a senior software engineer writing clear, concise guided tour steps for developers exploring an unfamiliar codebase.',
    buildUserPrompt: ({ filePath, index, excerpt }) => {
      const previousTitles = result.slice(0, index).join(', ') || 'none yet';
      return (
        `You are writing one step of a guided tour through a codebase. The user asked: '${query}'. ` +
        `The tour so far has covered: ${previousTitles}. ` +
        `The current step is the file \`${filePath}\`. Here's the relevant excerpt:\n\n${excerpt}\n\n` +
        `Write 2–4 sentences explaining what role this file plays in answering the user's question. ` +
        `Do not summarise the whole file — focus on its role in this specific flow.`
      );
    },
  });

  // 8. Optionally persist
  if (steps.length === 0) {
    return res.status(429).json({ error: 'Daily token budget exhausted' });
  }

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
      // Compensating delete: the tour row is already committed, so undo it rather
      // than leaving an empty tour visible in the library.
      console.error('[tour] Failed to insert tour steps:', stepsErr.message);
      await supabaseAdmin.from('tours').delete().eq('id', tour.id);
      return res.status(500).json({ error: 'Failed to save tour steps' });
    }

    return res.json({ tour, steps });
  }

  return res.json({ steps });
};

function getCreatorName(user) {
  const metadata = user?.user_metadata || {};
  const emailName = user?.email ? user.email.split('@')[0] : null;
  return metadata.name
    || metadata.full_name
    || metadata.user_name
    || metadata.preferred_username
    || emailName
    || user?.id
    || 'Unknown user';
}

function getCreatorAvatar(user) {
  const metadata = user?.user_metadata || {};
  return metadata.avatar_url || metadata.picture || '';
}

async function getCreatorMap(userIds) {
  const creators = new Map();

  await Promise.all(userIds.map(async (userId) => {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (error) throw error;
      const user = data?.user || {};
      creators.set(userId, {
        id: userId,
        name: getCreatorName(user),
        avatar_url: getCreatorAvatar(user),
      });
    } catch (err) {
      creators.set(userId, {
        id: userId,
        name: userId,
        avatar_url: '',
      });
    }
  }));

  return creators;
}

const listTours = async (req, res) => {
  const { repoId } = req.params;
  const userId = req.user.id;
  const access = await getRepoAccess(repoId, userId);

  if (!access.isOwner && !access.hasTeamAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { data: tourRows, error: toursErr } = await supabaseAdmin
    .from('tours')
    .select('id, repo_id, created_by, title, description, original_query, is_auto_generated, is_team_shared, forked_from, created_at, updated_at')
    .eq('repo_id', repoId)
    .order('updated_at', { ascending: false });

  if (toursErr) {
    console.error('[listTours] Failed to fetch tours:', toursErr.message);
    return res.status(500).json({ error: 'Failed to fetch tours' });
  }

  const visibleTours = (tourRows || []).filter((tour) => (
    tour.created_by === userId || (tour.is_team_shared && access.hasTeamAccess)
  ));

  const hasTeamForRepo = await repoHasTeam(repoId);

  if (visibleTours.length === 0) {
    return res.json({ tours: [], repo_has_team: hasTeamForRepo });
  }

  const tourIds = visibleTours.map((tour) => tour.id);
  const { data: stepRows, error: stepsErr } = await supabaseAdmin
    .from('tour_steps')
    .select('id, tour_id, step_order, file_path, start_line, end_line, explanation')
    .in('tour_id', tourIds)
    .order('step_order', { ascending: true });

  if (stepsErr) {
    console.error('[listTours] Failed to fetch tour steps:', stepsErr.message);
    return res.status(500).json({ error: 'Failed to fetch tour steps' });
  }

  const stepsByTour = new Map();
  for (const step of stepRows || []) {
    if (!stepsByTour.has(step.tour_id)) stepsByTour.set(step.tour_id, []);
    stepsByTour.get(step.tour_id).push(step);
  }

  const creatorIds = [...new Set(visibleTours.map((tour) => tour.created_by).filter(Boolean))];
  const creators = await getCreatorMap(creatorIds);

  // Resolve creators behind forked_from references (may differ from the fork's own creator).
  // forked_from is a tour id — look up the original tour's creator in one extra query.
  const forkedFromIds = [...new Set(visibleTours.map((t) => t.forked_from).filter(Boolean))];
  let forkSourceMap = new Map();
  if (forkedFromIds.length > 0) {
    const { data: forkSources } = await supabaseAdmin
      .from('tours')
      .select('id, created_by')
      .in('id', forkedFromIds);
    forkSourceMap = new Map((forkSources || []).map((row) => [row.id, row.created_by]));
  }
  const extraCreatorIds = [...new Set(forkSourceMap.values())]
    .filter((id) => id && !creators.has(id));
  if (extraCreatorIds.length > 0) {
    const extra = await getCreatorMap(extraCreatorIds);
    for (const [id, value] of extra.entries()) creators.set(id, value);
  }

  const tours = visibleTours.map((tour) => {
    const steps = stepsByTour.get(tour.id) || [];
    const forkedFromCreatorId = tour.forked_from ? forkSourceMap.get(tour.forked_from) : null;
    return {
      ...tour,
      step_count: steps.length,
      can_delete: tour.created_by === userId,
      can_edit:   tour.created_by === userId,
      creator: creators.get(tour.created_by) || { id: tour.created_by, name: tour.created_by, avatar_url: '' },
      forked_from_creator: forkedFromCreatorId
        ? (creators.get(forkedFromCreatorId) || { id: forkedFromCreatorId, name: forkedFromCreatorId, avatar_url: '' })
        : null,
      steps,
    };
  });

  res.json({ tours, repo_has_team: hasTeamForRepo });
};

/**
 * Validate the request body for PATCH /tours/:tourId (US-060).
 * Returns { ok: true } or { ok: false, status, error, field? }.
 */
async function validateUpdateBody({ repoId, body }) {
  if (!body || typeof body !== 'object') {
    return { ok: false, status: 400, error: 'Request body required' };
  }

  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim().length === 0)) {
    return { ok: false, status: 400, error: 'title must be a non-empty string', field: 'title' };
  }

  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    return { ok: false, status: 400, error: 'description must be a string or null', field: 'description' };
  }

  if (body.is_team_shared !== undefined && typeof body.is_team_shared !== 'boolean') {
    return { ok: false, status: 400, error: 'is_team_shared must be a boolean', field: 'is_team_shared' };
  }

  if (!Array.isArray(body.steps) || body.steps.length < 2) {
    return { ok: false, status: 400, error: 'At least 2 steps are required', field: 'steps' };
  }

  for (let i = 0; i < body.steps.length; i++) {
    const step  = body.steps[i] || {};
    const where = `steps[${i}]`;

    if (typeof step.file_path !== 'string' || step.file_path.trim().length === 0) {
      return { ok: false, status: 400, error: `${where}.file_path is required`, field: `${where}.file_path` };
    }
    if (typeof step.explanation !== 'string' || step.explanation.trim().length < 10) {
      return { ok: false, status: 400, error: `${where}.explanation must be at least 10 characters`, field: `${where}.explanation` };
    }
    const start = Number(step.start_line);
    const end   = Number(step.end_line);
    if (!Number.isInteger(start) || start < 1) {
      return { ok: false, status: 400, error: `${where}.start_line must be a positive integer`, field: `${where}.start_line` };
    }
    if (!Number.isInteger(end) || end < start) {
      return { ok: false, status: 400, error: `${where}.end_line must be ≥ start_line`, field: `${where}.end_line` };
    }
  }

  // Confirm every file_path exists in this repo's graph_nodes.
  const uniquePaths = [...new Set(body.steps.map((s) => s.file_path))];
  const { data: existingNodes, error: nodesErr } = await supabaseAdmin
    .from('graph_nodes')
    .select('file_path')
    .eq('repo_id', repoId)
    .in('file_path', uniquePaths);
  if (nodesErr) {
    return { ok: false, status: 500, error: 'Failed to validate file paths' };
  }
  const knownPaths = new Set((existingNodes || []).map((n) => n.file_path));
  for (const path of uniquePaths) {
    if (!knownPaths.has(path)) {
      return { ok: false, status: 400, error: `Unknown file path: ${path}`, field: 'steps' };
    }
  }

  return { ok: true };
}

async function repoHasTeam(repoId) {
  const { data, error } = await supabaseAdmin
    .from('team_repositories')
    .select('repo_id')
    .eq('repo_id', repoId)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

const updateTour = async (req, res) => {
  const { repoId, tourId } = req.params;
  const userId = req.user.id;

  if (!(await canAccessRepo(repoId, userId))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Ownership check — only the creator can edit.
  const { data: tour, error: tourErr } = await supabaseAdmin
    .from('tours')
    .select('id, created_by, is_team_shared')
    .eq('id', tourId)
    .eq('repo_id', repoId)
    .maybeSingle();

  if (tourErr) {
    console.error('[updateTour] failed to load tour:', tourErr.message);
    return res.status(500).json({ error: 'Failed to load tour' });
  }
  if (!tour) {
    return res.status(404).json({ error: 'Tour not found' });
  }
  if (tour.created_by !== userId) {
    return res.status(403).json({ error: 'Only the tour creator can edit this tour' });
  }

  const validation = await validateUpdateBody({ repoId, body: req.body });
  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error, field: validation.field });
  }

  const { title, description, is_team_shared, steps } = req.body;

  // US-061: team-share guard — only allow flipping to true if the repo has a team association.
  if (is_team_shared === true && tour.is_team_shared !== true) {
    if (!(await repoHasTeam(repoId))) {
      return res.status(400).json({ error: 'This repo is not associated with a team' });
    }
  }

  const stepsPayload = steps.map((step, idx) => ({
    ord:         Number.isInteger(step.order) ? step.order : idx,
    file_path:   step.file_path,
    start_line:  Number(step.start_line),
    end_line:    Number(step.end_line),
    explanation: step.explanation.trim(),
  }));

  const { error: rpcErr } = await supabaseAdmin.rpc('update_tour_with_steps', {
    p_tour_id:        tourId,
    p_title:          typeof title === 'string' ? title.trim() : null,
    p_description:    description === undefined ? null : description,
    p_is_team_shared: typeof is_team_shared === 'boolean' ? is_team_shared : null,
    p_steps:          stepsPayload,
  });
  if (rpcErr) {
    console.error('[updateTour] RPC failed:', rpcErr.message);
    return res.status(500).json({ error: 'Failed to update tour' });
  }

  // Return the freshly persisted tour + steps so the client can drop optimistic state.
  const { data: updated } = await supabaseAdmin
    .from('tours')
    .select('id, repo_id, created_by, title, description, original_query, is_auto_generated, is_team_shared, forked_from, created_at, updated_at')
    .eq('id', tourId)
    .single();

  const { data: updatedSteps } = await supabaseAdmin
    .from('tour_steps')
    .select('id, tour_id, step_order, file_path, start_line, end_line, explanation')
    .eq('tour_id', tourId)
    .order('step_order', { ascending: true });

  return res.json({ tour: updated, steps: updatedSteps || [] });
};

/**
 * POST /api/repos/:repoId/tours/:tourId/fork — US-061.
 * Deep-copies a tour into a new tour owned by the calling user.
 */
const forkTour = async (req, res) => {
  const { repoId, tourId } = req.params;
  const userId = req.user.id;

  const access = await getRepoAccess(repoId, userId);
  if (!access.isOwner && !access.hasTeamAccess) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Must be a tour the caller can actually see (own OR team-shared).
  const { data: sourceTour, error: srcErr } = await supabaseAdmin
    .from('tours')
    .select('id, created_by, is_team_shared, repo_id')
    .eq('id', tourId)
    .eq('repo_id', repoId)
    .maybeSingle();

  if (srcErr) {
    console.error('[forkTour] failed to load source tour:', srcErr.message);
    return res.status(500).json({ error: 'Failed to load source tour' });
  }
  if (!sourceTour) {
    return res.status(404).json({ error: 'Tour not found' });
  }
  const canRead = sourceTour.created_by === userId || (sourceTour.is_team_shared && access.hasTeamAccess);
  if (!canRead) {
    return res.status(403).json({ error: 'You cannot fork this tour' });
  }

  const { data: newTourId, error: rpcErr } = await supabaseAdmin.rpc('fork_tour', {
    p_tour_id: tourId,
    p_user_id: userId,
  });
  if (rpcErr || !newTourId) {
    console.error('[forkTour] RPC failed:', rpcErr?.message);
    return res.status(500).json({ error: 'Failed to fork tour' });
  }

  const { data: tour } = await supabaseAdmin
    .from('tours')
    .select('id, repo_id, created_by, title, description, original_query, is_auto_generated, is_team_shared, forked_from, created_at, updated_at')
    .eq('id', newTourId)
    .single();

  const { data: steps } = await supabaseAdmin
    .from('tour_steps')
    .select('id, tour_id, step_order, file_path, start_line, end_line, explanation')
    .eq('tour_id', newTourId)
    .order('step_order', { ascending: true });

  return res.status(201).json({ tour, steps: steps || [] });
};

/**
 * GET /api/repos/:repoId/tours/:tourId/share-impact — US-061.
 * Returns the count of teammates who can currently see a shared tour,
 * for the "X teammates can see this" delete-confirmation warning.
 */
const getShareImpact = async (req, res) => {
  const { repoId, tourId } = req.params;
  const userId = req.user.id;

  if (!(await canAccessRepo(repoId, userId))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { data: tour } = await supabaseAdmin
    .from('tours')
    .select('id, created_by, is_team_shared')
    .eq('id', tourId)
    .eq('repo_id', repoId)
    .maybeSingle();

  if (!tour) return res.status(404).json({ error: 'Tour not found' });
  if (!tour.is_team_shared) {
    return res.json({ teammate_count: 0 });
  }

  // Distinct teammates who share at least one team with this repo, excluding the creator.
  const { data: teamRepos } = await supabaseAdmin
    .from('team_repositories')
    .select('team_id')
    .eq('repo_id', repoId);
  const teamIds = (teamRepos || []).map((r) => r.team_id);
  if (teamIds.length === 0) return res.json({ teammate_count: 0 });

  const { data: members } = await supabaseAdmin
    .from('team_members')
    .select('user_id')
    .in('team_id', teamIds);
  const distinctUserIds = new Set((members || []).map((m) => m.user_id));
  distinctUserIds.delete(tour.created_by);

  return res.json({ teammate_count: distinctUserIds.size });
};

const deleteTour = async (req, res) => {
  const { repoId, tourId } = req.params;
  const userId = req.user.id;

  if (!(await canAccessRepo(repoId, userId))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { data: tour, error: tourErr } = await supabaseAdmin
    .from('tours')
    .select('id, created_by')
    .eq('id', tourId)
    .eq('repo_id', repoId)
    .maybeSingle();

  if (tourErr) {
    console.error('[deleteTour] Failed to fetch tour:', tourErr.message);
    return res.status(500).json({ error: 'Failed to delete tour' });
  }

  if (!tour) {
    return res.status(404).json({ error: 'Tour not found' });
  }

  if (tour.created_by !== userId) {
    return res.status(403).json({ error: 'Only the tour creator can delete this tour' });
  }

  const { error: deleteErr } = await supabaseAdmin
    .from('tours')
    .delete()
    .eq('id', tourId)
    .eq('repo_id', repoId)
    .eq('created_by', userId);

  if (deleteErr) {
    console.error('[deleteTour] Failed to delete tour:', deleteErr.message);
    return res.status(500).json({ error: 'Failed to delete tour' });
  }

  res.json({ ok: true });
};

module.exports = {
  generateTour,
  listTours,
  deleteTour,
  updateTour,
  forkTour,
  getShareImpact,
  explainSteps,
  _private: { getCreatorName, getCreatorAvatar },
};
