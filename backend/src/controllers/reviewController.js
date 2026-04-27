/**
 * Review controller — AI Code Review (US-026) + Security Audit Mode (US-048)
 */

const { OpenAI }        = require('openai');
const Anthropic         = require('@anthropic-ai/sdk');
const { supabaseAdmin } = require('../db/supabase');
const { recordUsage }   = require('../services/usageTracker');

const MODEL = 'claude-sonnet-4-20250514';
const MAX_DAILY_TOKENS = parseInt(process.env.MAX_DAILY_TOKENS_PER_USER || '500000', 10);
const SECURITY_KEYWORDS = ['auth', 'password', 'token', 'crypto', 'sanitize', 'exec', 'eval', 'sql'];
const WHOLE_REPO_AUDIT_LIMIT = 20;
const AUDIT_OUTPUT_TOKEN_ESTIMATE = 900;
const AUDIT_CONTEXT_TOKEN_ESTIMATE = 1800;
const EMBEDDING_TOKEN_ESTIMATE = 512;

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

async function remainingDailyTokens(userId) {
  return Math.max(0, MAX_DAILY_TOKENS - await dailyTokensUsed(userId));
}

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

function securityKeywordScore(text = '') {
  const lower = String(text).toLowerCase();
  return SECURITY_KEYWORDS.reduce((sum, keyword) => {
    const matches = lower.match(new RegExp(`\\b${keyword}\\b`, 'g'));
    return sum + (matches ? matches.length : 0);
  }, 0);
}

function rerankSecurityChunks(chunks = []) {
  return [...chunks].sort((a, b) => {
    const scoreDiff = securityKeywordScore(b.content) - securityKeywordScore(a.content);
    if (scoreDiff !== 0) return scoreDiff;
    return (a.distance || 0) - (b.distance || 0);
  });
}

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

function buildReviewPrompt(snippet, contextDescription, chunks, mode, filePath) {
  const contextBlocks = chunks.map(chunk => {
    const header = `--- ${chunk.file_path} (lines ${chunk.start_line}-${chunk.end_line}) ---`;
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
  } else if (mode === 'security_audit') {
    system = [
      'You are a security engineer reviewing code for vulnerabilities.',
      'Analyse the snippet in the context of the provided codebase excerpts.',
      'Assess injection vulnerabilities, auth/authz flaws, crypto misuse, secrets exposure, input validation gaps, error-handling information leaks, dependency risks, and logic flaws.',
      'Return findings as JSON lines only. Each finding must be an object with exactly these string fields: severity, category, line_reference, explanation, suggested_fix, confidence.',
      'Use severity and confidence values low, medium, or high. Cite the specific line or file line range in line_reference.',
      'If the code looks secure, return one JSON line with severity "low", category "secure", confidence "high", line_reference set to the reviewed file or snippet, explanation saying no issue was found, and suggested_fix set to "No fix needed.".',
      'Do not invent issues when evidence is weak.',
    ].join(' ');
  } else {
    system = [
      'You are reviewing a code snippet for a developer.',
      'You have context from their existing codebase below.',
      'Assess code quality, suggest improvements, and specifically note whether this code is consistent with the patterns and conventions you see in their codebase.',
    ].join(' ');
  }

  let user = `Code snippet to review${filePath ? ` from ${filePath}` : ''}:\n\`\`\`\n${snippet}\n\`\`\``;
  if (contextDescription && contextDescription.trim()) {
    user += `\n\nWhat this code is supposed to do: ${contextDescription.trim()}`;
  }
  if (contextBlocks) {
    user += `\n\nExisting codebase context:\n\n${contextBlocks}`;
  }

  return { system, user };
}

function buildDuplicationRefactorPrompt(cluster = {}) {
  const members = Array.isArray(cluster.members) ? cluster.members : [];
  const blocks = members.map((member, index) => {
    const header = `--- Duplicate member ${index + 1}: ${member.file_path || 'unknown'} lines ${member.start_line || '?'}-${member.end_line || '?'} ---`;
    return `${header}\n${member.content || member.excerpt || ''}`;
  }).join('\n\n');

  return {
    system: [
      'You are helping a developer remove duplicated code.',
      'Given semantically similar code chunks from one repository, propose a shared utility or abstraction.',
      'Return a concise refactor plan, the proposed shared code in a fenced code block, and per-file replacement notes.',
      'Do not invent missing files or APIs; base the proposal only on the supplied chunks.',
    ].join(' '),
    user: [
      `Duplication cluster: ${cluster.member_count || members.length} chunks, ${cluster.total_lines || 0} total duplicated lines.`,
      `Similarity range: ${cluster.similarity_min ?? 'unknown'} to ${cluster.similarity_max ?? 'unknown'}.`,
      '',
      blocks,
    ].join('\n'),
  };
}

function normalizeFinding(raw, fallback = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (value, allowed, def) => allowed.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : def;
  const required = ['severity', 'category', 'line_reference', 'explanation', 'suggested_fix', 'confidence'];
  const missing = required.filter((field) => raw[field] === undefined || raw[field] === null || String(raw[field]).trim() === '');
  if (missing.length > 0) return null;
  return {
    severity:       pick(raw.severity, ['low', 'medium', 'high'], 'medium'),
    category:       String(raw.category || fallback.category || 'security').slice(0, 80),
    line_reference: String(raw.line_reference || fallback.line_reference || fallback.file_path || 'snippet').slice(0, 160),
    explanation:    String(raw.explanation || raw.message || '').trim() || 'No explanation provided.',
    suggested_fix:  String(raw.suggested_fix || raw.fix || '').trim() || 'Review the referenced code and apply the safest local pattern.',
    confidence:     pick(raw.confidence, ['low', 'medium', 'high'], 'medium'),
    file_path:      raw.file_path || fallback.file_path || null,
  };
}

function parseFindingsFromText(text, fallback = {}) {
  const findings = [];
  const trimmed = String(text || '').trim();
  if (!trimmed) return findings;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const parseTargets = fenced ? [fenced[1].trim(), trimmed] : [trimmed];

  for (const target of parseTargets) {
    try {
      const parsed = JSON.parse(target);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      rows.forEach((row) => {
        const finding = normalizeFinding(row, fallback);
        if (finding) findings.push(finding);
      });
      if (findings.length > 0) return findings;
    } catch {
      // Try the next parser strategy.
    }
  }

  const jsonObjectMatches = trimmed.match(/\{[^{}]*(?:"severity"|"category"|"confidence")[^{}]*\}/g) || [];
  for (const candidate of jsonObjectMatches) {
    try {
      const finding = normalizeFinding(JSON.parse(candidate), fallback);
      if (finding) findings.push(finding);
    } catch {
      // Ignore malformed candidate objects while scanning streamed text.
    }
  }
  if (findings.length > 0) return findings;

  try {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    rows.forEach((row) => {
      const finding = normalizeFinding(row, fallback);
      if (finding) findings.push(finding);
    });
    if (findings.length > 0) return findings;
  } catch {
    // Fall through to line-by-line JSONL parsing.
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.trim().replace(/^```json|^```|```$/g, '').trim();
    if (!candidate.startsWith('{')) continue;
    try {
      const finding = normalizeFinding(JSON.parse(candidate), fallback);
      if (finding) findings.push(finding);
    } catch {
      // Skip malformed JSONL rows; partial streams can split objects.
    }
  }

  return findings;
}

function extractLineNumber(text = '') {
  const match = String(text).match(/(?:line|lines|:)\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function issueCategoryScore(finding, issue) {
  const category = String(finding.category || '').toLowerCase();
  const type = String(issue.type || '').toLowerCase();
  const description = String(issue.description || '').toLowerCase();
  const haystack = `${type} ${description}`;
  if (!category) return 0;
  if (haystack.includes(category)) return 3;
  if (category.includes('secret') && (type.includes('secret') || description.includes('secret') || description.includes('token') || description.includes('password'))) return 3;
  if ((category.includes('injection') || category.includes('exec') || category.includes('eval') || category.includes('sql')) && (type.includes('insecure') || description.includes('exec') || description.includes('eval') || description.includes('sql') || description.includes('injection'))) return 3;
  if ((category.includes('dependency') || category.includes('package')) && type.includes('vulnerable_dependency')) return 3;
  if ((category.includes('crypto') || category.includes('auth')) && (type.includes('insecure') || description.includes('crypto') || description.includes('auth'))) return 2;
  return 0;
}

function linkFindingsToIssues(findings, issues) {
  return findings.map((finding) => {
    const filePath = finding.file_path;
    const findingLine = extractLineNumber(finding.line_reference);
    const matches = (issues || [])
      .filter((issue) => Array.isArray(issue.file_paths) && issue.file_paths.includes(filePath))
      .map((issue) => {
        const issueLine = extractLineNumber(issue.description);
        const categoryScore = issueCategoryScore(finding, issue);
        const lineDistance = findingLine && issueLine ? Math.abs(findingLine - issueLine) : null;
        const lineScore = lineDistance === null ? 0 : lineDistance === 0 ? 3 : lineDistance <= 5 ? 2 : lineDistance <= 20 ? 1 : 0;
        return {
          ...issue,
          match_reason: {
            same_file: true,
            category_match: categoryScore > 0,
            line_proximity: lineDistance,
            score: 1 + categoryScore + lineScore,
          },
        };
      })
      .filter((issue) => issue.match_reason.score > 1)
      .sort((a, b) => b.match_reason.score - a.match_reason.score);
    return { ...finding, matching_analysis_issues: matches };
  });
}

function estimateTokensForText(text = '') {
  return Math.ceil(String(text).length / 4);
}

function estimateAuditTokens(source = '') {
  return EMBEDDING_TOKEN_ESTIMATE
    + Math.min(estimateTokensForText(source), 5000)
    + AUDIT_CONTEXT_TOKEN_ESTIMATE
    + AUDIT_OUTPUT_TOKEN_ESTIMATE;
}

async function embedSnippet(snippet, userId, endpoint = 'review') {
  const embedRes = await openai.embeddings.create({ model: 'text-embedding-3-small', input: snippet.trim() });
  const embedding = embedRes.data[0].embedding;
  const embedTokens = embedRes.usage?.total_tokens || 0;
  await recordUsage({ userId, endpoint, provider: 'openai', embeddingTokens: embedTokens });
  return embedding;
}

async function streamClaude({ system, user, send, userId, endpoint = 'review', maxTokens = 1500 }) {
  const stream = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
    stream: true,
  });

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  for await (const event of stream) {
    if (event.type === 'message_start') {
      inputTokens = event.message?.usage?.input_tokens || 0;
    } else if (event.type === 'message_delta') {
      outputTokens = event.usage?.output_tokens || outputTokens;
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      text += event.delta.text;
      send?.({ type: 'chunk', text: event.delta.text });
    }
  }

  await recordUsage({ userId, endpoint, provider: 'anthropic', promptTokens: inputTokens, completionTokens: outputTokens });
  return { text, inputTokens, outputTokens };
}

async function fetchFileSource(repoId, filePath) {
  const { data: fc, error: fcErr } = await supabaseAdmin
    .from('file_contents')
    .select('content')
    .eq('repo_id', repoId)
    .eq('file_path', filePath)
    .maybeSingle();
  if (!fcErr && fc?.content) return fc.content;

  const { data: chunks, error } = await supabaseAdmin
    .from('code_chunks')
    .select('content, start_line')
    .eq('repo_id', repoId)
    .eq('file_path', filePath)
    .order('start_line', { ascending: true });
  if (error || !chunks || chunks.length === 0) return null;
  return chunks.map((chunk) => chunk.content).join('\n');
}

async function fetchDeterministicIssues(repoId, filePaths) {
  if (!filePaths.length) return [];
  const { data, error } = await supabaseAdmin
    .from('analysis_issues')
    .select('id, type, severity, description, file_paths')
    .eq('repo_id', repoId);
  if (error) return [];
  const wanted = new Set(filePaths);
  return (data || []).filter((issue) => (issue.file_paths || []).some((path) => wanted.has(path)));
}

async function fetchAuditTargets(repoId) {
  const { data, error } = await supabaseAdmin.rpc('get_security_audit_targets', {
    p_repo_id: repoId,
    p_limit: WHOLE_REPO_AUDIT_LIMIT,
  });
  if (!error && data) return data;

  const { data: rows, error: fallbackErr } = await supabaseAdmin
    .from('graph_nodes')
    .select('id, file_path, language, incoming_count, complexity_score, line_count')
    .eq('repo_id', repoId)
    .limit(1000);
  if (fallbackErr) throw fallbackErr;
  return (rows || [])
    .map((row) => ({ ...row, audit_score: (row.incoming_count || 0) + (row.complexity_score || 0) }))
    .sort((a, b) => (b.audit_score || 0) - (a.audit_score || 0))
    .slice(0, WHOLE_REPO_AUDIT_LIMIT);
}

async function persistAudit({ userId, repoId, report }) {
  const { data, error } = await supabaseAdmin
    .from('security_audits')
    .insert({ user_id: userId, repo_id: repoId, findings_json: report })
    .select()
    .single();
  if (error) {
    console.warn('[security-audit] Failed to persist audit:', error.message);
    return null;
  }
  return data;
}

function sendFactory(res) {
  return (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function openSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

const review = async (req, res) => {
  const { repoId } = req.params;
  const { snippet, context: contextDescription, mode = 'review', filePath } = req.body;

  if (!snippet || typeof snippet !== 'string' || snippet.trim().length === 0) {
    return res.status(400).json({ error: 'snippet is required' });
  }

  const lineCount = snippet.split('\n').length;
  const lineLimit = mode === 'security_audit' ? 1000 : 200;
  if (lineCount > lineLimit) {
    return res.status(400).json({ error: `snippet must not exceed ${lineLimit} lines` });
  }

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  openSse(res);
  const send = sendFactory(res);

  try {
    if (!process.env.OPENAI_API_KEY) {
      send({ type: 'error', message: 'Review is not available: OpenAI API key not configured.' });
      return res.end();
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      send({ type: 'error', message: 'Review is not available: Anthropic API key not configured.' });
      return res.end();
    }

    let embedding;
    try {
      embedding = await embedSnippet(snippet, req.user.id, 'review');
    } catch {
      send({ type: 'error', message: 'Failed to process your snippet. Please try again.' });
      return res.end();
    }

    let chunks;
    try {
      const retrieved = await retrieveChunks(repoId, embedding, mode === 'security_audit' ? 12 : 5);
      chunks = mode === 'security_audit' ? rerankSecurityChunks(retrieved).slice(0, 5) : retrieved.slice(0, 5);
    } catch {
      send({ type: 'error', message: 'Failed to search the codebase index. Please try again.' });
      return res.end();
    }

    send({ type: 'sources', sources: chunks.map(formatSource) });
    const { system, user } = buildReviewPrompt(snippet.trim(), contextDescription, chunks, mode, filePath);
    // In security_audit mode, suppress raw chunk events — findings arrive as structured `finding` SSE events instead.
    const chunkSend = mode === 'security_audit' ? null : send;
    const { text } = await streamClaude({ system, user, send: chunkSend, userId: req.user.id, endpoint: 'review' });

    if (mode === 'security_audit') {
      const issues = await fetchDeterministicIssues(repoId, filePath ? [filePath] : []);
      const findings = linkFindingsToIssues(parseFindingsFromText(text, { file_path: filePath }), issues);
      findings.forEach((finding) => send({ type: 'finding', finding }));
    }

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

const runSecurityAudit = async (req, res) => {
  const { repoId } = req.params;
  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  openSse(res);
  const send = sendFactory(res);

  const report = {
    status: 'complete',
    files: [],
    summary: { total_files: 0, audited_count: 0, skipped_count: 0, findings_count: 0, by_severity: {}, by_category: {}, narrative: '' },
    deterministic_links: [],
    raw_text: '',
  };

  try {
    if (!process.env.OPENAI_API_KEY || !process.env.ANTHROPIC_API_KEY) {
      send({ type: 'error', message: 'Security audit is not available: AI provider key not configured.' });
      return res.end();
    }

    const targets = await fetchAuditTargets(repoId);
    report.summary.total_files = targets.length;
    const preparedTargets = [];

    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      const source = await fetchFileSource(repoId, target.file_path);
      if (!source) {
        report.summary.skipped_count++;
        report.files.push({ file_path: target.file_path, status: 'skipped', reason: 'No retrievable source', audit_score: target.audit_score });
        send({ type: 'progress', file_path: target.file_path, index: index + 1, total: targets.length, status: 'skipped' });
        continue;
      }
      preparedTargets.push({
        target,
        source,
        estimated_tokens: estimateAuditTokens(source),
      });
    }

    report.summary.estimated_tokens = preparedTargets.reduce((sum, item) => sum + item.estimated_tokens, 0);
    let remaining = await remainingDailyTokens(req.user.id);
    if (preparedTargets.length > 0 && remaining < preparedTargets[0].estimated_tokens) {
      report.status = 'partial';
      report.summary.narrative = `Security audit was not started because the next file needs about ${preparedTargets[0].estimated_tokens.toLocaleString()} tokens and only ${remaining.toLocaleString()} remain.`;
      const audit = await persistAudit({ userId: req.user.id, repoId, report });
      send({ type: 'summary', summary: report.summary, status: report.status, audit });
      send({ type: 'done', audit, status: report.status });
      return res.end();
    }

    const deterministicIssues = await fetchDeterministicIssues(repoId, targets.map((target) => target.file_path));

    for (let index = 0; index < preparedTargets.length; index++) {
      const { target, source, estimated_tokens: estimatedTokens } = preparedTargets[index];
      remaining = await remainingDailyTokens(req.user.id);
      if (remaining < estimatedTokens) {
        report.status = 'partial';
        report.summary.budget_stop = {
          file_path: target.file_path,
          estimated_tokens: estimatedTokens,
          remaining_tokens: remaining,
        };
        send({
          type: 'progress',
          file_path: target.file_path,
          index: index + 1,
          total: preparedTargets.length,
          status: 'budget_stopped',
          estimated_tokens: estimatedTokens,
          remaining_tokens: remaining,
        });
        break;
      }

      send({ type: 'progress', file_path: target.file_path, index: index + 1, total: preparedTargets.length, status: 'auditing', estimated_tokens: estimatedTokens, remaining_tokens: remaining });

      const embedding = await embedSnippet(source.slice(0, 12000), req.user.id, 'security_audit');
      const retrieved = await retrieveChunks(repoId, embedding, 12);
      const chunks = rerankSecurityChunks(retrieved).slice(0, 5);
      send({ type: 'sources', file_path: target.file_path, sources: chunks.map(formatSource) });

      remaining = await remainingDailyTokens(req.user.id);
      const promptEstimate = Math.min(estimateTokensForText(source), 5000) + AUDIT_CONTEXT_TOKEN_ESTIMATE + AUDIT_OUTPUT_TOKEN_ESTIMATE;
      if (remaining < promptEstimate) {
        report.status = 'partial';
        report.summary.budget_stop = {
          file_path: target.file_path,
          estimated_tokens: promptEstimate,
          remaining_tokens: remaining,
        };
        send({ type: 'progress', file_path: target.file_path, index: index + 1, total: preparedTargets.length, status: 'budget_stopped', estimated_tokens: promptEstimate, remaining_tokens: remaining });
        break;
      }

      const { system, user } = buildReviewPrompt(source.slice(0, 20000), `Whole-repo security audit target: ${target.file_path}`, chunks, 'security_audit', target.file_path);
      const { text } = await streamClaude({ system, user, send, userId: req.user.id, endpoint: 'security_audit', maxTokens: 1200 });
      report.raw_text += `\n\n--- ${target.file_path} ---\n${text}`;

      const fileIssues = deterministicIssues.filter((issue) => (issue.file_paths || []).includes(target.file_path));
      let findings = parseFindingsFromText(text, { file_path: target.file_path, line_reference: target.file_path });
      findings = linkFindingsToIssues(findings, fileIssues);
      findings.forEach((finding) => {
        report.summary.findings_count++;
        report.summary.by_severity[finding.severity] = (report.summary.by_severity[finding.severity] || 0) + 1;
        report.summary.by_category[finding.category] = (report.summary.by_category[finding.category] || 0) + 1;
        if (finding.matching_analysis_issues?.length) {
          report.deterministic_links.push({
            file_path: target.file_path,
            finding,
            issue_ids: finding.matching_analysis_issues.map((issue) => issue.id),
          });
        }
        send({ type: 'finding', file_path: target.file_path, finding });
      });

      report.summary.audited_count++;
      report.files.push({
        file_path: target.file_path,
        status: 'audited',
        audit_score: target.audit_score ?? ((target.incoming_count || 0) + (target.complexity_score || 0)),
        incoming_count: target.incoming_count || 0,
        complexity_score: target.complexity_score || 0,
        findings,
      });
      send({ type: 'progress', file_path: target.file_path, index: index + 1, total: preparedTargets.length, status: 'audited' });
    }

    report.summary.narrative = report.status === 'partial'
      ? `Partial security audit completed: ${report.summary.audited_count} audited, ${report.summary.skipped_count} skipped.`
      : `Security audit completed: ${report.summary.audited_count} audited, ${report.summary.skipped_count} skipped.`;

    const audit = await persistAudit({ userId: req.user.id, repoId, report });
    send({ type: 'summary', summary: report.summary, status: report.status, audit });
    send({ type: 'done', audit, status: report.status });
    res.end();
  } catch (err) {
    console.error('[security-audit] Unhandled error:', err);
    report.status = 'partial';
    report.summary.narrative = 'Security audit stopped because an unexpected error occurred.';
    const audit = await persistAudit({ userId: req.user.id, repoId, report });
    try {
      send({ type: 'error', message: 'Security audit stopped unexpectedly. A partial report was saved.', audit });
      res.end();
    } catch {
      res.end();
    }
  }
};

const listSecurityAudits = async (req, res) => {
  const { repoId } = req.params;
  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const { data, error } = await supabaseAdmin
    .from('security_audits')
    .select('id, user_id, repo_id, findings_json, created_at')
    .eq('repo_id', repoId)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch security audit history' });
  res.json({ audits: data || [] });
};

const getSecurityAudit = async (req, res) => {
  const { repoId, auditId } = req.params;
  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const { data, error } = await supabaseAdmin
    .from('security_audits')
    .select('id, user_id, repo_id, findings_json, created_at')
    .eq('id', auditId)
    .eq('repo_id', repoId)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Failed to fetch security audit' });
  if (!data) return res.status(404).json({ error: 'Security audit not found' });
  res.json({ audit: data });
};

const duplicationRefactor = async (req, res) => {
  const { repoId } = req.params;
  const { cluster } = req.body || {};

  if (!cluster || !Array.isArray(cluster.members) || cluster.members.length < 2) {
    return res.status(400).json({ error: 'cluster with at least two members is required' });
  }

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  openSse(res);
  const send = sendFactory(res);

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      send({ type: 'error', message: 'Duplication refactor is not available: Anthropic API key not configured.' });
      return res.end();
    }

    const { system, user } = buildDuplicationRefactorPrompt(cluster);
    await streamClaude({
      system,
      user,
      send,
      userId: req.user.id,
      endpoint: 'duplication_refactor',
      maxTokens: 1800,
    });

    send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error('[duplication-refactor] Unhandled error:', err);
    try {
      send({ type: 'error', message: 'Failed to generate a duplication refactor. Please try again.' });
      res.end();
    } catch {
      res.end();
    }
  }
};

module.exports = {
  review,
  runSecurityAudit,
  listSecurityAudits,
  getSecurityAudit,
  duplicationRefactor,
  _private: {
    parseFindingsFromText,
    rerankSecurityChunks,
    securityKeywordScore,
    linkFindingsToIssues,
    estimateAuditTokens,
    buildDuplicationRefactorPrompt,
  },
};
