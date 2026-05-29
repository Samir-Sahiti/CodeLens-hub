/**
 * Agent controller (US-069).
 *
 * Drives the Anthropic tool-use loop, persists every turn to agent_messages,
 * and streams events to the client over SSE. The conversation history rail
 * (US-071) is also served from here.
 *
 * Persistence-as-you-go is the load-bearing correctness property: every
 * assistant text block, every tool_use, and every tool_result is INSERTed
 * before the next anthropic.messages.create call. A crashed or aborted stream
 * leaves the conversation resumable from the last persisted turn.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { supabaseAdmin } = require('../db/supabase');
const { canAccessRepo } = require('../lib/repoAccess');
const { bindRequestAbort, isAbortError } = require('../lib/sseAbort');
const { withSupabaseRetry } = require('../lib/dbHelpers');
const { recordUsage } = require('../services/usageTracker');
const { tools, toolHandlers, isReadOnlyTool } = require('../services/agentTools');

const MODEL = 'claude-sonnet-4-20250514';
const TITLE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_ITERATIONS = parseInt(process.env.AGENT_MAX_ITERATIONS || '15', 10);
const TOKEN_CAP = parseInt(process.env.AGENT_TOKEN_CAP || '50000', 10);
const MAX_OUTPUT_TOKENS = 4096;

const _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'sk-ant-dummy' });
const anthropic = new Proxy(_anthropic, {
  get(_t, p) {
    const a = globalThis.__CODELENS_ANTHROPIC__ || _anthropic;
    const v = a[p];
    return typeof v === 'function' ? v.bind(a) : v;
  },
});

function buildSystemPrompt(repoFullName) {
  return [
    `You are an AI repo agent for CodeLens. The user has connected the repo \`${repoFullName || 'unknown'}\`.`,
    'You have access to deterministic structural analysis through tools — the dependency graph,',
    'issue findings, attack-surface classification, RAG retrieval, file reads, and a refactor proposal generator.',
    'Prefer tools over guessing: when asked about impact, call `get_blast_radius`; when asked about security,',
    'call `list_issues` + `get_attack_paths`; when asked about specific code, call `search_code` then `read_file`.',
    'Be concise. Cite file paths in backticks. When you propose a fix, explain why before calling `propose_fix`.',
  ].join(' ');
}

// ─── SSE helpers ──────────────────────────────────────────────────────────

function openSse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

function sendFactory(res) {
  return (payload) => {
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* socket gone */ }
  };
}

// ─── message rehydration ──────────────────────────────────────────────────

/**
 * Group persisted agent_messages rows into Anthropic's message format.
 * Consecutive 'assistant' + 'tool_use' rows fold into one assistant message;
 * consecutive 'tool_result' rows fold into one user message.
 */
function rehydrateMessages(rows) {
  const out = [];
  let pending = null; // { role: 'assistant' | 'user', content: [...] }
  const flush = () => { if (pending) { out.push(pending); pending = null; } };
  for (const row of rows) {
    const c = row.content_json || {};
    if (row.role === 'user') {
      flush();
      out.push({ role: 'user', content: [{ type: 'text', text: c.text || '' }] });
    } else if (row.role === 'assistant') {
      if (!pending || pending.role !== 'assistant') { flush(); pending = { role: 'assistant', content: [] }; }
      if (c.text) pending.content.push({ type: 'text', text: c.text });
    } else if (row.role === 'tool_use') {
      if (!pending || pending.role !== 'assistant') { flush(); pending = { role: 'assistant', content: [] }; }
      pending.content.push({ type: 'tool_use', id: c.tool_use_id, name: c.tool_name, input: c.input || {} });
    } else if (row.role === 'tool_result') {
      if (!pending || pending.role !== 'user') { flush(); pending = { role: 'user', content: [] }; }
      pending.content.push({
        type: 'tool_result',
        tool_use_id: c.tool_use_id,
        content: JSON.stringify(c.output),
        is_error: Boolean(c.is_error),
      });
    }
  }
  flush();
  return out;
}

// ─── db helpers ───────────────────────────────────────────────────────────

async function insertMessage(conversationId, role, contentJson, tokenUsage = null) {
  const { error } = await supabaseAdmin.from('agent_messages').insert({
    conversation_id: conversationId,
    role,
    content_json: contentJson,
    token_usage: tokenUsage,
  });
  if (error) console.warn('[agent] insert message failed:', error.message);
}

async function bumpConversationTokens(conversationId, addInput, addOutput) {
  const { data } = await supabaseAdmin
    .from('agent_conversations')
    .select('total_tokens')
    .eq('id', conversationId)
    .maybeSingle();
  const next = (data?.total_tokens || 0) + addInput + addOutput;
  await withSupabaseRetry(
    () => supabaseAdmin
      .from('agent_conversations')
      .update({ total_tokens: next, updated_at: new Date().toISOString() })
      .eq('id', conversationId),
    { tries: 3, label: 'agent_conversations.update' }
  );
  return next;
}

async function readTotalTokens(conversationId) {
  const { data } = await supabaseAdmin
    .from('agent_conversations')
    .select('total_tokens')
    .eq('id', conversationId)
    .maybeSingle();
  return data?.total_tokens || 0;
}

async function generateTitleAsync(conversationId, firstMessage) {
  try {
    const res = await anthropic.messages.create({
      model: TITLE_MODEL,
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: `Summarise this question as a 4–6 word title. Reply with the title only, no quotes.\n\nQuestion: ${firstMessage}`,
      }],
    });
    const title = (res.content?.[0]?.text || '').trim().replace(/^["']|["']$/g, '').slice(0, 80);
    if (title) {
      await supabaseAdmin
        .from('agent_conversations')
        .update({ title })
        .eq('id', conversationId)
        .is('title', null);
    }
  } catch (err) {
    console.warn('[agent] title generation failed:', err.message);
  }
}

// ─── stream parsing ───────────────────────────────────────────────────────

/**
 * Consume an Anthropic stream into a structured turn result. Emits text_delta
 * and tool_use SSE events as content arrives. Returns the final turn shape:
 *   { textBlocks: [string], toolUses: [{ id, name, input }],
 *     inputTokens, outputTokens, stopReason }
 */
async function consumeStream(stream, send) {
  const blocks = []; // ordered: { type: 'text', text } | { type: 'tool_use', id, name, partialJson }
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = null;

  for await (const event of stream) {
    if (event.type === 'message_start') {
      inputTokens = event.message?.usage?.input_tokens || 0;
    } else if (event.type === 'content_block_start') {
      const cb = event.content_block || {};
      if (cb.type === 'text') {
        blocks[event.index] = { type: 'text', text: '' };
      } else if (cb.type === 'tool_use') {
        blocks[event.index] = { type: 'tool_use', id: cb.id, name: cb.name, partialJson: '' };
      }
    } else if (event.type === 'content_block_delta') {
      const b = blocks[event.index];
      if (!b) continue;
      if (event.delta?.type === 'text_delta') {
        b.text += event.delta.text;
        send({ type: 'text_delta', delta: event.delta.text });
      } else if (event.delta?.type === 'input_json_delta') {
        b.partialJson += event.delta.partial_json || '';
      }
    } else if (event.type === 'content_block_stop') {
      // Tool_use blocks get parsed at stop.
    } else if (event.type === 'message_delta') {
      if (event.usage?.output_tokens) outputTokens = event.usage.output_tokens;
      if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
    }
  }

  const textBlocks = [];
  const toolUses = [];
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === 'text') {
      textBlocks.push(b.text);
    } else if (b.type === 'tool_use') {
      let input = {};
      try { input = b.partialJson ? JSON.parse(b.partialJson) : {}; } catch { /* malformed input */ }
      toolUses.push({ id: b.id, name: b.name, input });
    }
  }
  return { textBlocks, toolUses, inputTokens, outputTokens, stopReason };
}

// ─── route handlers ───────────────────────────────────────────────────────

/** POST /api/repos/:repoId/agent/chat */
const chat = async (req, res) => {
  const { repoId } = req.params;
  const userId = req.user.id;
  const { conversation_id: existingConvId, message } = req.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const allowed = await canAccessRepo(repoId, userId);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Agent unavailable: Anthropic API key not configured' });
  }

  // Fetch repo full_name for the system prompt.
  const { data: repo } = await supabaseAdmin
    .from('repositories')
    .select('full_name')
    .eq('id', repoId)
    .maybeSingle();

  openSse(res);
  const send = sendFactory(res);
  const { signal, cleanup } = bindRequestAbort(req);

  let conversationId = existingConvId;
  let isFirstTurn = false;

  try {
    if (!conversationId) {
      const { data: newConv, error: convErr } = await supabaseAdmin
        .from('agent_conversations')
        .insert({ repo_id: repoId, user_id: userId })
        .select('id')
        .single();
      if (convErr) {
        send({ type: 'error', message: 'Could not start a new conversation' });
        return res.end();
      }
      conversationId = newConv.id;
      isFirstTurn = true;
      send({ type: 'conversation_created', conversation_id: conversationId });
    } else {
      // Validate ownership.
      const { data: existing } = await supabaseAdmin
        .from('agent_conversations')
        .select('id, user_id')
        .eq('id', conversationId)
        .maybeSingle();
      if (!existing || existing.user_id !== userId) {
        send({ type: 'error', message: 'Conversation not found' });
        return res.end();
      }
    }

    await insertMessage(conversationId, 'user', { text: message.trim() });

    // Load prior messages (excluding the one we just inserted is fine — we'll
    // refetch them all to rebuild Anthropic's messages array in order).
    const { data: rows } = await supabaseAdmin
      .from('agent_messages')
      .select('role, content_json, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    const messages = rehydrateMessages(rows || []);
    const system = buildSystemPrompt(repo?.full_name);

    let totalInput = 0;
    let totalOutput = 0;

    for (let iter = 0; iter < MAX_ITERATIONS; iter += 1) {
      const currentTotal = await readTotalTokens(conversationId);
      if (currentTotal >= TOKEN_CAP) {
        if (totalInput || totalOutput) {
          await bumpConversationTokens(conversationId, totalInput, totalOutput);
          await recordUsage({
            userId,
            endpoint: 'agent_chat',
            provider: 'anthropic',
            promptTokens: totalInput,
            completionTokens: totalOutput,
          });
        }
        send({ type: 'budget_stopped', total_tokens: currentTotal });
        return res.end();
      }

      let turn;
      try {
        const stream = await anthropic.messages.create({
          model: MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          system,
          messages,
          tools,
          tool_choice: { type: 'auto' },
          stream: true,
        }, { signal });
        turn = await consumeStream(stream, send);
      } catch (err) {
        if (isAbortError(err, signal)) return res.end();
        console.error('[agent] anthropic stream error:', err);
        send({ type: 'error', message: 'Model call failed' });
        return res.end();
      }

      totalInput += turn.inputTokens;
      totalOutput += turn.outputTokens;

      // Persist the assistant turn (text + any tool_use blocks) so a crash
      // mid-tool-execution still leaves the conversation rehydratable.
      const assistantText = turn.textBlocks.join('');
      const tokenUsage = { input_tokens: turn.inputTokens, output_tokens: turn.outputTokens };
      await insertMessage(conversationId, 'assistant', { text: assistantText }, tokenUsage);
      for (const tu of turn.toolUses) {
        await insertMessage(conversationId, 'tool_use', {
          tool_name: tu.name,
          input: tu.input,
          tool_use_id: tu.id,
        });
        send({ type: 'tool_use', tool_use_id: tu.id, tool_name: tu.name, input: tu.input });
      }

      // Add the assistant message to the running Anthropic context.
      const assistantContent = [];
      if (assistantText) assistantContent.push({ type: 'text', text: assistantText });
      for (const tu of turn.toolUses) {
        assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
      }
      if (assistantContent.length > 0) messages.push({ role: 'assistant', content: assistantContent });

      // Fire-and-forget title generation after the first assistant response.
      if (isFirstTurn && iter === 0) {
        generateTitleAsync(conversationId, message.trim());
      }

      if (turn.stopReason !== 'tool_use' || turn.toolUses.length === 0) {
        const newTotal = await bumpConversationTokens(conversationId, totalInput, totalOutput);
        await recordUsage({
          userId,
          endpoint: 'agent_chat',
          provider: 'anthropic',
          promptTokens: totalInput,
          completionTokens: totalOutput,
        });
        send({ type: 'finish', stop_reason: turn.stopReason || 'end_turn', total_tokens: newTotal });
        return res.end();
      }

      // Execute tool calls. Read-only tools in parallel; propose_fix sequential after.
      const ctx = { repoId, userId };
      const readOnlyCalls = turn.toolUses.filter((tu) => isReadOnlyTool(tu.name));
      const writeCalls = turn.toolUses.filter((tu) => !isReadOnlyTool(tu.name));

      const runTool = async (tu) => {
        const handler = toolHandlers[tu.name];
        if (!handler) {
          return { id: tu.id, output: { is_error: true, message: `Unknown tool: ${tu.name}` } };
        }
        try {
          const output = await handler(tu.input, ctx);
          return { id: tu.id, output };
        } catch (err) {
          return { id: tu.id, output: { is_error: true, message: err.message } };
        }
      };

      const readResults = await Promise.all(readOnlyCalls.map(runTool));
      const writeResults = [];
      for (const tu of writeCalls) writeResults.push(await runTool(tu));
      // Re-order results to match the original tool_use order so the
      // tool_result blocks Anthropic sees line up.
      const byId = new Map([...readResults, ...writeResults].map((r) => [r.id, r]));
      const orderedResults = turn.toolUses.map((tu) => byId.get(tu.id));

      const userContent = [];
      for (const r of orderedResults) {
        const isError = Boolean(r.output?.is_error);
        await insertMessage(conversationId, 'tool_result', {
          tool_use_id: r.id,
          output: r.output,
          is_error: isError,
        });
        send({ type: 'tool_result', tool_use_id: r.id, output: r.output, is_error: isError });
        userContent.push({
          type: 'tool_result',
          tool_use_id: r.id,
          content: JSON.stringify(r.output),
          is_error: isError,
        });
      }
      messages.push({ role: 'user', content: userContent });
    }

    // Exhausted max iterations.
    const newTotal = await bumpConversationTokens(conversationId, totalInput, totalOutput);
    await recordUsage({
      userId,
      endpoint: 'agent_chat',
      provider: 'anthropic',
      promptTokens: totalInput,
      completionTokens: totalOutput,
    });
    send({ type: 'finish', stop_reason: 'max_iterations', total_tokens: newTotal });
    res.end();
  } catch (err) {
    console.error('[agent] unhandled error:', err);
    try { send({ type: 'error', message: 'An unexpected error occurred' }); } catch { /* */ }
    try { res.end(); } catch { /* */ }
  } finally {
    cleanup();
  }
};

// ─── conversation history (US-071) ────────────────────────────────────────

const PAGE_SIZE = 20;

const listConversations = async (req, res) => {
  const { repoId } = req.params;
  const userId = req.user.id;
  const page = Math.max(0, parseInt(req.query.page || '0', 10));

  const allowed = await canAccessRepo(repoId, userId);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE;
  const { data, error } = await supabaseAdmin
    .from('agent_conversations')
    .select('id, title, total_tokens, updated_at')
    .eq('repo_id', repoId)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .range(from, to);

  if (error) return res.status(500).json({ error: error.message });
  const items = (data || []).slice(0, PAGE_SIZE);
  const hasMore = (data || []).length > PAGE_SIZE;
  res.json({ items, page, has_more: hasMore });
};

const getConversation = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const { data: conv, error: convErr } = await supabaseAdmin
    .from('agent_conversations')
    .select('id, repo_id, user_id, title, total_tokens, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (convErr) return res.status(500).json({ error: convErr.message });
  if (!conv || conv.user_id !== userId) return res.status(404).json({ error: 'Conversation not found' });

  const { data: msgs, error: msgErr } = await supabaseAdmin
    .from('agent_messages')
    .select('id, role, content_json, token_usage, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });
  if (msgErr) return res.status(500).json({ error: msgErr.message });

  res.json({
    id: conv.id,
    repo_id: conv.repo_id,
    title: conv.title,
    total_tokens: conv.total_tokens,
    created_at: conv.created_at,
    updated_at: conv.updated_at,
    messages: msgs || [],
  });
};

const updateConversation = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { title } = req.body || {};
  if (typeof title !== 'string') return res.status(400).json({ error: 'title is required' });

  const { data: existing } = await supabaseAdmin
    .from('agent_conversations')
    .select('user_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing || existing.user_id !== userId) return res.status(404).json({ error: 'Conversation not found' });

  const { data, error } = await supabaseAdmin
    .from('agent_conversations')
    .update({ title: title.slice(0, 200) })
    .eq('id', id)
    .select('id, title, updated_at')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
};

const deleteConversation = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const { data: existing } = await supabaseAdmin
    .from('agent_conversations')
    .select('user_id')
    .eq('id', id)
    .maybeSingle();
  if (!existing || existing.user_id !== userId) return res.status(404).json({ error: 'Conversation not found' });

  const { error } = await supabaseAdmin.from('agent_conversations').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
};

// ─── suggestions endpoint (US-070) ────────────────────────────────────────

const FALLBACK_SUGGESTIONS = [
  'Which files are most worth writing tests for first?',
  'Walk me through the entry points of this repo.',
  'Where is authentication enforced?',
  'What\'s the biggest architectural smell here?',
];

const getSuggestions = async (req, res) => {
  const { repoId } = req.params;
  const userId = req.user.id;

  const allowed = await canAccessRepo(repoId, userId);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  try {
    const { data: issues } = await supabaseAdmin
      .from('analysis_issues')
      .select('type, file_paths')
      .eq('repo_id', repoId)
      .range(0, 999);

    const byType = new Map();
    for (const issue of issues || []) {
      if (!byType.has(issue.type)) byType.set(issue.type, []);
      byType.get(issue.type).push(issue);
    }

    const suggestions = [];
    const firstPath = (type) => byType.get(type)?.[0]?.file_paths?.[0];

    if (byType.has('missing_auth')) {
      suggestions.push('Where are the unauthenticated routes?');
    }
    if (byType.has('god_file')) {
      const p = firstPath('god_file');
      suggestions.push(p ? `Why is \`${p}\` flagged as a god file?` : 'Why are some files flagged as god files?');
    }
    if (byType.has('dead_code')) {
      const p = firstPath('dead_code');
      suggestions.push(p ? `What would break if I removed \`${p}\`?` : 'Which files are dead code?');
    }
    if (byType.has('vulnerable_dependency')) {
      suggestions.push('Which dependencies have known CVEs?');
    }

    for (const fb of FALLBACK_SUGGESTIONS) {
      if (suggestions.length >= 4) break;
      suggestions.push(fb);
    }

    res.json({ suggestions: suggestions.slice(0, 4) });
  } catch (err) {
    console.warn('[agent] suggestions fallback:', err.message);
    res.json({ suggestions: FALLBACK_SUGGESTIONS.slice(0, 4) });
  }
};

module.exports = {
  chat,
  listConversations,
  getConversation,
  updateConversation,
  deleteConversation,
  getSuggestions,
  _private: { rehydrateMessages, buildSystemPrompt },
};
