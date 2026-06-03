/**
 * Review controller — AI Code Review (US-026) + Security Audit Mode (US-048)
 */

const path              = require('path');
const crypto            = require('crypto');
const { OpenAI }        = require('openai');
const Anthropic         = require('@anthropic-ai/sdk');
const { supabaseAdmin } = require('../db/supabase');
const { recordUsage }   = require('../services/usageTracker');

function getOctokit(githubToken) {
  const { Octokit } = globalThis.__CODELENS_OCTOKIT__ || require('octokit');
  return new Octokit({ auth: githubToken });
}
const { bindRequestAbort, isAbortError } = require('../lib/sseAbort');
const { withSupabaseRetry } = require('../lib/dbHelpers');
const { getGithubTokenForUser } = require('../lib/githubAuth');
const { scanFileForSecrets } = require('../services/secretScanner');
const { scanFileForInsecurePatterns } = require('../services/sastEngine');
const { scanFileForMissingAuth } = require('../services/authCoverageScanner');
const { isManifestFile, parseManifest } = require('../services/manifestParser');
const { scanDependencies } = require('../services/osvScanner');
const { getBlastRadius } = require('../services/graphService');
const { emitPrReviewReady } = require('../services/notificationEvents');
const { enqueueNotification, recipientsForRepo } = require('../services/notifications');
const { scoreIssuesForRepo } = require('../services/riskScoring');

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

// Phase 3.3: read the api_usage_daily rollup instead of scanning api_usage.
// Mirrors the aiRateLimit middleware so per-target audit budget checks (which
// run once per file in a whole-repo audit) stay O(1) regardless of usage
// table size. A 24h rolling window straddles at most two UTC days.
async function dailyTokensUsed(userId) {
  const now    = new Date();
  const today  = now.toISOString().slice(0, 10);
  const yest   = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from('api_usage_daily')
    .select('prompt_tokens, completion_tokens, embedding_tokens')
    .eq('user_id', userId)
    .in('usage_date', [today, yest]);
  if (error) return 0;
  return (data || []).reduce(
    (sum, row) => sum + Number(row.prompt_tokens || 0) + Number(row.completion_tokens || 0) + Number(row.embedding_tokens || 0),
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

async function streamClaude({ system, user, send, userId, endpoint = 'review', maxTokens = 1500, req }) {
  const { signal, cleanup } = bindRequestAbort(req);
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let aborted = false;

  try {
    const stream = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      stream: true,
    }, { signal });

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
  } catch (err) {
    if (isAbortError(err, signal)) {
      aborted = true;
      console.warn(`[review] Claude stream aborted by client disconnect (endpoint=${endpoint}, partial_output_tokens=${outputTokens})`);
    } else {
      throw err;
    }
  } finally {
    cleanup();
  }

  // Record usage even on abort — input tokens were already billed and any partial
  // output tokens count too. Skipping this would let abuse vectors hide cost.
  await recordUsage({ userId, endpoint, provider: 'anthropic', promptTokens: inputTokens, completionTokens: outputTokens });
  return { text, inputTokens, outputTokens, aborted };
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

function normalizeReviewFilePath(filePath) {
  return String(filePath || '').trim();
}

function extractRuleIdFromDescription(description = '') {
  const match = String(description).match(/Rule ID:\s*([A-Za-z0-9_.:-]+)/i);
  return match ? match[1] : '';
}

function getFindingPath(finding = {}) {
  return normalizeReviewFilePath(finding.file_path || (Array.isArray(finding.file_paths) ? finding.file_paths[0] : ''));
}

function getFindingRuleId(finding = {}) {
  return String(finding.rule_id || finding._meta?.rule_id || finding.rule?.id || extractRuleIdFromDescription(finding.description || finding.message || '') || finding.type || '').trim();
}

function getFindingLine(finding = {}) {
  const line = finding.line_number ?? finding._meta?.line_number ?? extractLineNumber(finding.description || finding.message || '');
  const numeric = Number(line);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildAnalysisIssueKey(filePath, type, line, description, ruleId = '') {
  const normalizedFile = normalizeReviewFilePath(filePath);
  const normalizedType = String(type || '').toLowerCase();
  const normalizedLine = line != null ? String(line) : '';
  const normalizedRule = String(ruleId || '').toLowerCase();
  const normalizedDesc = String(description || '').trim().slice(0, 120);
  return `${normalizedFile}::${normalizedType}::${normalizedRule}::${normalizedLine}::${normalizedDesc}`;
}

function buildAnalysisIssueKeySet(issues = []) {
  const keys = new Set();
  for (const issue of issues) {
    const type = issue.type || '';
    const line = extractLineNumber(issue.description || '');
    const description = issue.description || '';
    const ruleId = extractRuleIdFromDescription(description) || type;
    for (const filePath of issue.file_paths || []) {
      const normalizedFile = normalizeReviewFilePath(filePath);
      const normalizedRule = String(ruleId || '').toLowerCase();
      keys.add(buildAnalysisIssueKey(filePath, type, line, description, ruleId));
      keys.add(buildAnalysisIssueKey(filePath, type, '', description, ruleId));
      if (ruleId) {
        keys.add(`${normalizedFile}::${normalizedRule}::${line || ''}`);
        keys.add(`${normalizedFile}::${normalizedRule}::`);
      }
    }
  }
  return keys;
}

function findingMatchesExistingIssue(finding, existingIssueKeys) {
  const filePath = getFindingPath(finding);
  if (!filePath) return false;
  const type = finding.type || String(finding.category || '').toLowerCase();
  const line = getFindingLine(finding);
  const description = finding.description || finding.message || '';
  const ruleId = getFindingRuleId(finding);
  const exactKey = buildAnalysisIssueKey(filePath, type, line, description, ruleId);
  const fallbackKey = buildAnalysisIssueKey(filePath, type, '', description, ruleId);
  const ruleLineKey = `${filePath}::${String(ruleId || '').toLowerCase()}::${line || ''}`;
  return existingIssueKeys.has(exactKey) || existingIssueKeys.has(fallbackKey) || existingIssueKeys.has(ruleLineKey);
}

async function fetchFileContentAtRef(octokit, owner, repo, filePath, ref) {
  try {
    const blob = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref });
    if (blob && blob.data && blob.data.content) {
      return Buffer.from(blob.data.content, blob.data.encoding || 'base64').toString('utf8');
    }
  } catch (err) {
    return null;
  }
  return null;
}

async function parseManifestDependenciesFromRef(octokit, owner, repo, filePath, ref) {
  const content = await fetchFileContentAtRef(octokit, owner, repo, filePath, ref);
  if (!content) return [];
  return parseManifest(filePath, content);
}

async function scanManifestDiffForVulnerableDeps(octokit, owner, repo, filePath, baseRef, headRef, repoId) {
  const headDeps = await parseManifestDependenciesFromRef(octokit, owner, repo, filePath, headRef);
  if (!headDeps.length) return [];
  const baseDeps = await parseManifestDependenciesFromRef(octokit, owner, repo, filePath, baseRef);
  const baseKeys = new Set(baseDeps.map((dep) => `${dep.ecosystem}::${dep.name}::${dep.version}`));
  const changedDeps = headDeps.filter((dep) => !baseKeys.has(`${dep.ecosystem}::${dep.name}::${dep.version}`));
  if (!changedDeps.length) return [];

  const { issues } = await scanDependencies(changedDeps, repoId);
  return issues.map((issue) => ({
    ...issue,
    file_path: filePath,
    _meta: { rule_id: 'vulnerable_dependency', line_number: 0 },
  }));
}

function extractAddedLineNumbers(patch = '') {
  const added = new Set();
  let newLine = 0;
  for (const rawLine of String(patch || '').split(/\r?\n/)) {
    const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (rawLine.startsWith('+++')) continue;
    if (rawLine.startsWith('+')) {
      if (newLine > 0) added.add(newLine);
      newLine += 1;
      continue;
    }
    if (rawLine.startsWith('-')) continue;
    if (newLine > 0) newLine += 1;
  }
  return added;
}

function extractAddedLineEntries(patch = '') {
  const entries = [];
  let newLine = 0;
  for (const rawLine of String(patch || '').split(/\r?\n/)) {
    const hunk = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (rawLine.startsWith('+++')) continue;
    if (rawLine.startsWith('+')) {
      if (newLine > 0) entries.push({ line_number: newLine, content: rawLine.slice(1) });
      newLine += 1;
      continue;
    }
    if (rawLine.startsWith('-')) continue;
    if (newLine > 0) newLine += 1;
  }
  return entries;
}

function contextHashForLine(content = '', lineNumber = null) {
  const line = Number(lineNumber);
  if (!Number.isFinite(line) || line <= 0) return null;
  const lines = String(content || '').split(/\r?\n/);
  const start = Math.max(0, line - 2);
  const end = Math.min(lines.length, line + 1);
  return crypto.createHash('sha256').update(lines.slice(start, end).join('\n')).digest('hex');
}

function buildFindingContextKey(finding, content = '') {
  const ruleId = getFindingRuleId(finding);
  const hash = contextHashForLine(content, getFindingLine(finding));
  return ruleId && hash ? `${ruleId}::${hash}` : null;
}

function normalizePrFinding(raw, fallback = {}) {
  const filePath = getFindingPath(raw) || fallback.file_path || '';
  const lineNumber = getFindingLine(raw);
  const ruleId = getFindingRuleId(raw);
  const message = String(raw.message || raw.description || raw.explanation || raw.type || 'PR review finding').trim();
  return {
    id: raw.id || crypto.createHash('sha1').update(`${filePath}:${lineNumber || ''}:${ruleId}:${message}`).digest('hex').slice(0, 16),
    type: raw.type || fallback.type || 'pr_review',
    severity: ['critical', 'high', 'medium', 'low'].includes(String(raw.severity || '').toLowerCase())
      ? String(raw.severity).toLowerCase()
      : 'medium',
    file_path: filePath,
    line_number: lineNumber,
    rule_id: ruleId,
    message,
    ai_explanation: null,
    suggested_fix: null,
    blast_radius: fallback.blast_radius || raw.blast_radius || null,
    _meta: {
      ...(raw._meta || {}),
      rule_id: ruleId,
      line_number: lineNumber,
      source: fallback.source || raw._meta?.source || 'deterministic',
    },
  };
}

function buildSuppressionKeys(row = {}) {
  const filePath = normalizeReviewFilePath(row.file_path);
  const ruleId = String(row.rule_id || '').trim();
  const line = row.line_number == null ? '' : String(row.line_number);
  return [`${filePath}::${ruleId}::${line}`];
}

function isSuppressedFinding(finding, suppressedSet) {
  const filePath = getFindingPath(finding);
  const ruleId = getFindingRuleId(finding);
  const line = getFindingLine(finding);
  return suppressedSet.has(`${filePath}::${ruleId}::${line || ''}`)
    || suppressedSet.has(`${filePath}::${ruleId}::`);
}

async function blastRadiusForFile(repoId, filePath) {
  try {
    const radius = await getBlastRadius(repoId, filePath);
    const direct = Array.isArray(radius.direct) ? radius.direct : [];
    const transitive = Array.isArray(radius.transitive) ? radius.transitive : [];
    return {
      direct_count: direct.length,
      transitive_count: transitive.length,
      direct: direct.slice(0, 10),
      transitive: transitive.slice(0, 10),
    };
  } catch (err) {
    console.warn('[pr-review] blast radius failed for', filePath, err.message);
    return { direct_count: 0, transitive_count: 0, direct: [], transitive: [] };
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCodeLensReviewLink(repoId, reviewId) {
  const pathPart = `/repo/${repoId}?tab=pulls&review=${reviewId}`;
  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  return frontendUrl ? `${frontendUrl}${pathPart}` : pathPart;
}

function escapeMarkdownTable(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function getPrFindingMessage(finding = {}) {
  return String(finding.message || finding.description || finding.explanation || finding.type || 'PR review finding').trim();
}

function hasInlineLocation(finding = {}) {
  return Boolean(getFindingPath(finding)) && Number(getFindingLine(finding)) > 0;
}

function getSeverityCounts(findings = []) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    const severity = String(finding.severity || '').toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, severity)) counts[severity] += 1;
  }
  return counts;
}

function choosePrReviewEvent(findings = [], threshold = 'critical') {
  const hasCritical = findings.some((finding) => String(finding.severity || '').toLowerCase() === 'critical');
  const hasHigh = findings.some((finding) => String(finding.severity || '').toLowerCase() === 'high');
  if (threshold === 'high' && (hasCritical || hasHigh)) return 'REQUEST_CHANGES';
  if (threshold === 'critical' && hasCritical) return 'REQUEST_CHANGES';
  return 'COMMENT';
}

function buildPrReviewBody({ review, findings, severityCounts, reviewLink }) {
  const rows = findings.slice(0, 50).map((finding) => {
    const location = hasInlineLocation(finding)
      ? `${getFindingPath(finding)}:${getFindingLine(finding)}`
      : getFindingPath(finding) || 'Summary';
    return `| ${escapeMarkdownTable(finding.severity || 'medium')} | ${escapeMarkdownTable(getFindingRuleId(finding) || 'n/a')} | ${escapeMarkdownTable(location)} | ${escapeMarkdownTable(getPrFindingMessage(finding))} |`;
  });
  const fileLevel = findings.filter((finding) => !hasInlineLocation(finding));
  const sections = [
    `## CodeLens PR Review #${review.pr_number}`,
    `Review: [View in CodeLens](${reviewLink})`,
    '',
    `Findings: ${findings.length} total — critical ${severityCounts.critical}, high ${severityCounts.high}, medium ${severityCounts.medium}, low ${severityCounts.low}.`,
    '',
    '| Severity | Rule | Location | Message |',
    '| --- | --- | --- | --- |',
    rows.length ? rows.join('\n') : '| - | - | - | No findings |',
  ];
  if (findings.length > rows.length) {
    sections.push('', `Showing first ${rows.length} findings in this summary table.`);
  }
  if (fileLevel.length > 0) {
    sections.push('', '### File-level findings');
    for (const finding of fileLevel) {
      sections.push(`- **${finding.severity || 'medium'}** \`${getFindingRuleId(finding) || 'n/a'}\` ${getFindingPath(finding) || 'summary'} — ${getPrFindingMessage(finding)}`);
    }
  }
  return sections.join('\n');
}

function buildInlineReviewComment(finding, reviewLink) {
  return [
    `**CodeLens ${String(finding.severity || 'medium').toUpperCase()}**`,
    '',
    `Rule: \`${getFindingRuleId(finding) || 'n/a'}\``,
    '',
    getPrFindingMessage(finding),
    '',
    `[View in CodeLens](${reviewLink})`,
  ].join('\n');
}

function getReturnedInlineComments(reviewData = {}) {
  const candidates = [
    reviewData.comments,
    reviewData.review_comments,
    reviewData.pull_request_review_comments,
  ];
  return candidates.find((value) => Array.isArray(value)) || [];
}

function mapPrPublishGithubError(err) {
  const status = err?.status || err?.response?.status;
  if (status === 401) return { http: 401, code: 'github_token_revoked', message: 'Your GitHub token has expired. Reconnect GitHub from Settings.' };
  if (status === 403) return { http: 403, code: 'github_no_write_access', message: 'GitHub rejected the publish. Confirm the repo owner token has pull request write access.' };
  if (status === 404) return { http: 404, code: 'github_not_found', message: 'The repository, pull request, or review no longer exists on GitHub.' };
  if (status === 422) return { http: 422, code: 'github_validation_failed', message: 'GitHub rejected one or more review comments. CodeLens logged details and retried once.' };
  if (status === 429 || (typeof status === 'number' && status >= 500 && status < 600)) {
    return { http: 502, code: 'github_unavailable', message: 'GitHub is temporarily unavailable. Try again in a minute.' };
  }
  return { http: 500, code: 'github_publish_failed', message: 'Failed to publish the PR review.' };
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
      // Phase 1.6: security_audit fetched 12 chunks then sliced to 5 after re-rank,
      // wasting ~half the vector compute. 6 keeps the re-rank meaningful while
      // halving the distance work.
      const retrieved = await retrieveChunks(repoId, embedding, mode === 'security_audit' ? 6 : 5);
      chunks = mode === 'security_audit' ? rerankSecurityChunks(retrieved).slice(0, 5) : retrieved.slice(0, 5);
    } catch {
      send({ type: 'error', message: 'Failed to search the codebase index. Please try again.' });
      return res.end();
    }

    send({ type: 'sources', sources: chunks.map(formatSource) });
    const { system, user } = buildReviewPrompt(snippet.trim(), contextDescription, chunks, mode, filePath);
    // In security_audit mode, suppress raw chunk events — findings arrive as structured `finding` SSE events instead.
    const chunkSend = mode === 'security_audit' ? null : send;
    const { text, aborted } = await streamClaude({ system, user, send: chunkSend, userId: req.user.id, endpoint: 'review', req });
    if (aborted) return res.end();

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
      // Phase 1.6: retrieve 6 then keep 5 — half the vector distance compute we
      // were spending when this was 12.
      const retrieved = await retrieveChunks(repoId, embedding, 6);
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
      const { text, aborted } = await streamClaude({ system, user, send, userId: req.user.id, endpoint: 'security_audit', maxTokens: 1200, req });
      if (aborted) {
        // Client disconnected mid-audit. Persist a partial report so the user
        // can resume from where we stopped, then exit the loop without billing
        // for remaining targets.
        report.status = 'partial';
        report.summary.narrative = `Security audit aborted by client after ${report.summary.audited_count} file(s).`;
        const audit = await persistAudit({ userId: req.user.id, repoId, report });
        try { send({ type: 'aborted', audit }); } catch { /* connection already gone */ }
        return res.end();
      }
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
    const { aborted } = await streamClaude({
      system,
      user,
      send,
      userId: req.user.id,
      endpoint: 'duplication_refactor',
      maxTokens: 1800,
      req,
    });

    if (!aborted) send({ type: 'done' });
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

// POST /api/repos/:repoId/pulls/:number/reviews
const runPrReview = async (req, res) => {
  const { repoId, number } = req.params;
  const prNumber = Number(number);

  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return res.status(400).json({ error: 'Valid pull request number is required' });
  }

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  try {
    const githubToken = await getGithubTokenForUser(req.user.id);
    if (!githubToken) {
      return res.status(401).json({ error: 'No GitHub token available for this user; unable to fetch PR details.' });
    }

    const { data: repoRec } = await supabaseAdmin
      .from('repositories')
      .select('full_name, name')
      .eq('id', repoId)
      .maybeSingle();
    const fullName = repoRec?.full_name || repoRec?.name || '';
    if (!fullName || !fullName.includes('/')) {
      return res.status(400).json({ error: 'Repository metadata missing full_name' });
    }

    openSse(res);
    const send = sendFactory(res);
    const [owner, repo] = fullName.split('/');
    const result = await runPrReviewBackground({
      repoId,
      prNumber,
      owner,
      repo,
      githubToken,
      userId: req.user.id,
      send,
      res,
    });

    if (!result || !result.reviewId) {
      res.end();
      return;
    }

    res.end();
  } catch (err) {
    console.error('[pr-review] error:', err);
    try {
      if (!res.headersSent) {
        return res.status(500).json({ error: 'PR review failed to complete.' });
      }
      const send = sendFactory(res);
      send({ type: 'error', message: 'PR review failed to complete.' });
    } catch {
      // Ignore stream write errors during cleanup.
    }
    res.end();
  }
};

async function runPrReviewBackground({ repoId, prNumber, owner, repo, githubToken, userId, send = () => {}, _res = null }) {
  const octokit = getOctokit(githubToken);
  let reviewRow = null;
  const markFailed = async (message) => {
    if (!reviewRow?.id) return;
    await supabaseAdmin
      .from('pr_reviews')
      .update({ status: 'failed', summary: message })
      .eq('id', reviewRow.id);
  };

  try {
    const pr = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    const headSha = pr.data.head.sha;
    const baseSha = pr.data.base.sha;

    await supabaseAdmin
      .from('pr_reviews')
      .update({ status: 'stale' })
      .eq('repo_id', repoId)
      .eq('pr_number', prNumber)
      .neq('pr_head_sha', headSha)
      .in('status', ['pending', 'analyzing', 'ready']);

    const createRes = await supabaseAdmin
      .from('pr_reviews')
      .upsert({
        repo_id: repoId,
        pr_number: prNumber,
        pr_head_sha: headSha,
        pr_base_sha: baseSha,
        user_id: userId,
        status: 'analyzing',
        summary: null,
      }, { onConflict: 'repo_id,pr_number,pr_head_sha' })
      .select()
      .maybeSingle();

    if (createRes.error || !createRes.data) {
      send({ type: 'error', message: 'Failed to create PR review record' });
      return null;
    }

    reviewRow = createRes.data;

    const files = [];
    for await (const response of octokit.paginate.iterator(octokit.rest.pulls.listFiles, { owner, repo, pull_number: prNumber, per_page: 100 })) {
      for (const f of response.data) files.push(f);
    }

    const capped = files.sort((a, b) => (b.additions || 0) - (a.additions || 0)).slice(0, 50);
    if (files.length > capped.length) {
      send({ type: 'truncated', total_files: files.length, analyzed_files: capped.length });
    }

    const { data: suppressions } = await supabaseAdmin
      .from('issue_suppressions')
      .select('file_path, rule_id, line_number')
      .eq('repo_id', repoId);
    const suppressedSet = new Set((suppressions || []).flatMap(buildSuppressionKeys));

    const previousIssues = await fetchDeterministicIssues(repoId, capped.map((f) => f.filename));
    const existingIssueKeys = buildAnalysisIssueKeySet(previousIssues);
    const findings = [];

    for (const f of capped) {
      send({ type: 'analyzing_file', file: f.filename });
      const patch = f.patch || '';
      const addedEntries = extractAddedLineEntries(patch);
      const addedLineNumbers = extractAddedLineNumbers(patch);
      const blast_radius = await blastRadiusForFile(repoId, f.filename);

      for (const entry of addedEntries) {
        try {
          const secrets = await scanFileForSecrets(f.filename, entry.content);
          for (const secret of secrets) {
            const normalized = normalizePrFinding({
              ...secret,
              file_path: f.filename,
              _meta: { ...(secret._meta || {}), line_number: entry.line_number },
            }, { file_path: f.filename, source: 'secret', blast_radius });
            findings.push(normalized);
          }
        } catch (err) {
          console.warn('[pr-review] secret scan failed for', f.filename, err.message);
        }
      }

      const newContent = await fetchFileContentAtRef(octokit, owner, repo, f.filename, headSha);
      const baseContent = await fetchFileContentAtRef(octokit, owner, repo, f.filename, baseSha);

      if (isManifestFile(f.filename)) {
        try {
          const scaFindings = await scanManifestDiffForVulnerableDeps(octokit, owner, repo, f.filename, baseSha, headSha, repoId);
          for (const issue of scaFindings) {
            findings.push(normalizePrFinding(issue, { file_path: f.filename, source: 'sca', blast_radius }));
          }
        } catch (err) {
          console.warn('[pr-review] SCA manifest scan failed for', f.filename, err.message);
        }
      }

      if (newContent) {
        try {
          const baseSast = baseContent ? await scanFileForInsecurePatterns(f.filename, baseContent, []) : [];
          const baseContextKeys = new Set(baseSast.map((issue) => buildFindingContextKey(issue, baseContent)).filter(Boolean));
          const sastFindings = await scanFileForInsecurePatterns(f.filename, newContent, []);
          for (const sf of sastFindings) {
            const line = getFindingLine(sf);
            const contextKey = buildFindingContextKey(sf, newContent);
            if (line && !addedLineNumbers.has(line)) continue;
            if (contextKey && baseContextKeys.has(contextKey)) continue;
            findings.push(normalizePrFinding({ ...sf, file_path: f.filename }, { file_path: f.filename, source: 'sast', blast_radius }));
          }
        } catch (err) {
          console.warn('[pr-review] SAST failed for', f.filename, err.message);
        }

        try {
          const baseAuthKeys = new Set(
            (baseContent ? scanFileForMissingAuth(f.filename, baseContent, []) : [])
              .map((issue) => `${getFindingPath(issue) || f.filename}::${getFindingRuleId(issue)}::${getFindingLine(issue) || ''}`)
          );
          const authIssues = scanFileForMissingAuth(f.filename, newContent, []);
          for (const a of authIssues) {
            const authKey = `${getFindingPath(a) || f.filename}::${getFindingRuleId(a)}::${getFindingLine(a) || ''}`;
            if (baseAuthKeys.has(authKey)) continue;
            findings.push(normalizePrFinding({ ...a, file_path: f.filename }, { file_path: f.filename, source: 'auth', blast_radius }));
          }
        } catch (err) {
          console.warn('[pr-review] auth coverage scan failed for', f.filename, err.message);
        }
      }
    }

    const filteredRaw = findings.filter((fg) => {
      if (isSuppressedFinding(fg, suppressedSet)) return false;
      if (findingMatchesExistingIssue(fg, existingIssueKeys)) return false;
      return true;
    });
    const filtered = (await scoreIssuesForRepo(repoId, filteredRaw.map((finding) => ({
      ...finding,
      file_paths: finding.file_path ? [finding.file_path] : [],
      description: finding.message,
    })))).sort((a, b) => (b.risk_score ?? -Infinity) - (a.risk_score ?? -Infinity));

    for (const finding of filtered) {
      send({ type: 'finding', finding });
    }

    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of filtered) {
      if (['critical', 'high', 'medium', 'low'].includes(f.severity)) {
        severityCounts[f.severity] += 1;
      }
    }

    const { data: repoIndexState } = await supabaseAdmin
      .from('repositories')
      .select('latest_indexed_sha')
      .eq('id', repoId)
      .maybeSingle();
    const indexedSha = repoIndexState?.latest_indexed_sha || null;
    const stalenessNote = !indexedSha
      ? 'Index staleness: unknown; this repository has no recorded indexed commit yet.'
      : indexedSha === headSha
        ? `Index is current with the PR head (${indexedSha.slice(0, 7)}).`
        : `Index is at ${indexedSha.slice(0, 7)} while the PR head is ${headSha.slice(0, 7)}; blast-radius numbers may be slightly stale.`;
    const summary = [
      `PR review completed for #${prNumber} at ${headSha}.`,
      stalenessNote,
    ].join(' ');

    const updateRes = await supabaseAdmin.from('pr_reviews').update({
      findings_json: filtered,
      summary,
      status: 'ready',
      total_findings: filtered.length,
      severity_counts: severityCounts,
    }).eq('id', reviewRow.id);
    if (updateRes?.error) throw new Error(`Failed to update PR review: ${updateRes.error.message}`);

    send({ type: 'summary', total_files: capped.length, total_findings: filtered.length, severity_counts: severityCounts, summary });
    send({ type: 'done', review_id: reviewRow.id });
    emitPrReviewReady({ review_id: reviewRow.id, repo_id: repoId, pr_number: prNumber, head_sha: headSha, total_findings: filtered.length, severity_counts: severityCounts });
    // US-077: in-app notification for owner + team members.
    try {
      const recipients = await recipientsForRepo(repoId);
      if (recipients.length > 0) {
        await enqueueNotification({
          user_ids: recipients,
          repo_id: repoId,
          type: 'pr_review_ready',
          severity: (severityCounts.critical > 0 || severityCounts.high > 0) ? 'warning' : 'info',
          payload: { review_id: reviewRow.id, pr_number: prNumber, total_findings: filtered.length, severity_counts: severityCounts },
          link_url: `/repo/${repoId}?tab=pulls&pr=${prNumber}&review=${reviewRow.id}`,
          dedup_key: `pr_review_ready::${prNumber}::${headSha}`,
        });
      }
    } catch (notifyErr) {
      console.warn('[pr-review] notification emission failed:', notifyErr?.message || notifyErr);
    }
    try {
      const { data: repoSettings } = await supabaseAdmin
        .from('repositories')
        .select('pr_review_auto_publish')
        .eq('id', repoId)
        .maybeSingle();
      if (repoSettings?.pr_review_auto_publish === true) {
        await publishPrReview({ repoId, reviewId: reviewRow.id });
      }
    } catch (publishErr) {
      console.warn('[pr-review] auto-publish failed:', publishErr?.message || publishErr);
    }
    return { reviewId: reviewRow.id };
  } catch (err) {
    const message = `PR review failed: ${err.message || 'Unexpected error'}`;
    await markFailed(message);
    send({ type: 'error', message });
    return null;
  }
}

async function fetchPrDiffLineIndex(octokit, owner, repo, prNumber) {
  const index = new Map();
  for await (const response of octokit.paginate.iterator(octokit.rest.pulls.listFiles, { owner, repo, pull_number: prNumber, per_page: 100 })) {
    for (const file of response.data || []) {
      index.set(file.filename, extractAddedLineNumbers(file.patch || ''));
    }
  }
  return index;
}

function lineExistsInDiff(diffLineIndex, filePath, lineNumber) {
  const lines = diffLineIndex.get(filePath);
  return Boolean(lines && lines.has(Number(lineNumber)));
}

async function cleanupPreviousPrReviewComments({ octokit, owner, repo, repoId, review }) {
  const diffLineIndex = await fetchPrDiffLineIndex(octokit, owner, repo, review.pr_number);
  const { data: rows } = await supabaseAdmin
    .from('pr_review_comments')
    .select('id, review_id, github_comment_id, file_path, line_number, kind, pr_reviews!inner(repo_id, pr_number)')
    .eq('pr_reviews.repo_id', repoId)
    .eq('pr_reviews.pr_number', review.pr_number)
    .neq('review_id', review.id);

  for (const row of rows || []) {
    if (!row.github_comment_id) continue;
    try {
      if (row.kind === 'inline') {
        if (row.file_path && row.line_number && lineExistsInDiff(diffLineIndex, row.file_path, row.line_number)) {
          await octokit.rest.pulls.updateReviewComment({
            owner,
            repo,
            comment_id: row.github_comment_id,
            body: '[Outdated - see updated review below]',
          });
        } else {
          await octokit.rest.pulls.deleteReviewComment({ owner, repo, comment_id: row.github_comment_id });
        }
      } else if (row.kind === 'summary' && typeof octokit.rest.pulls.updateReview === 'function') {
        await octokit.rest.pulls.updateReview({
          owner,
          repo,
          pull_number: review.pr_number,
          review_id: row.github_comment_id,
          body: '[Outdated - see updated review below]',
        });
      }
    } catch (err) {
      if ((err?.status || err?.response?.status) !== 404) {
        console.warn('[pr-review.publish] previous comment cleanup failed:', err?.message || err);
      }
    }
  }
}

// Idempotent re-publish of the SAME review (same head_sha keeps the same row):
// delete the prior inline comments, mark the prior summary review outdated, and
// clear the persisted rows so the upcoming publish does not duplicate them.
async function resetCurrentReviewComments({ octokit, owner, repo, review }) {
  const { data: rows } = await supabaseAdmin
    .from('pr_review_comments')
    .select('id, github_comment_id, kind')
    .eq('review_id', review.id);
  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    if (!row.github_comment_id) continue;
    try {
      if (row.kind === 'inline') {
        await octokit.rest.pulls.deleteReviewComment({ owner, repo, comment_id: row.github_comment_id });
      } else if (row.kind === 'summary' && typeof octokit.rest.pulls.updateReview === 'function') {
        await octokit.rest.pulls.updateReview({
          owner,
          repo,
          pull_number: review.pr_number,
          review_id: row.github_comment_id,
          body: '[Outdated - see updated review below]',
        });
      }
    } catch (err) {
      if ((err?.status || err?.response?.status) !== 404) {
        console.warn('[pr-review.publish] current review comment reset failed:', err?.message || err);
      }
    }
  }
  await supabaseAdmin.from('pr_review_comments').delete().eq('review_id', review.id);
}

async function fetchCreatedReviewInlineComments({ octokit, owner, repo, review, reviewData, inlineFindings }) {
  if (!reviewData?.id || inlineFindings.length === 0) return [];
  if (typeof octokit.rest.pulls.listCommentsForReview !== 'function') {
    return getReturnedInlineComments(reviewData);
  }
  const { data } = await octokit.rest.pulls.listCommentsForReview({
    owner,
    repo,
    pull_number: review.pr_number,
    review_id: reviewData.id,
    per_page: 100,
  });
  return Array.isArray(data) ? data : [];
}

async function persistPrReviewCommentIds({ octokit, owner, repo, review, reviewData, inlineFindings }) {
  const rows = [];
  if (reviewData?.id) {
    rows.push({
      review_id: review.id,
      github_comment_id: reviewData.id,
      file_path: null,
      line_number: null,
      kind: 'summary',
    });
  }

  const returnedInlineComments = await fetchCreatedReviewInlineComments({ octokit, owner, repo, review, reviewData, inlineFindings });
  returnedInlineComments.forEach((comment, index) => {
    if (!comment?.id) return;
    const finding = inlineFindings.find((candidate) => (
      getFindingPath(candidate) === comment.path &&
      Number(getFindingLine(candidate)) === Number(comment.line)
    )) || inlineFindings[index];
    if (!finding) return;
    rows.push({
      review_id: review.id,
      github_comment_id: comment.id,
      file_path: getFindingPath(finding),
      line_number: getFindingLine(finding),
      kind: 'inline',
    });
  });

  if (rows.length === 0) return { inlineCount: 0, summaryCount: 0 };

  const { error } = await supabaseAdmin.from('pr_review_comments').insert(rows);
  if (error) throw new Error(`Failed to persist GitHub review comment ids: ${error.message}`);
  return {
    inlineCount: rows.filter((row) => row.kind === 'inline').length,
    summaryCount: rows.filter((row) => row.kind === 'summary').length,
  };
}

async function publishPrReview({ repoId, reviewId, actorUserId = null, retry422 = true }) {
  const { data: review, error: reviewErr } = await supabaseAdmin
    .from('pr_reviews')
    .select('id, repo_id, pr_number, pr_head_sha, pr_base_sha, status, findings_json, summary, total_findings, severity_counts')
    .eq('id', reviewId)
    .eq('repo_id', repoId)
    .maybeSingle();
  if (reviewErr) throw Object.assign(new Error('Failed to load PR review'), { status: 500 });
  if (!review) throw Object.assign(new Error('PR review not found'), { status: 404 });
  if (review.status !== 'ready') throw Object.assign(new Error('Only ready PR reviews can be published'), { status: 409 });

  const { data: repoRow, error: repoErr } = await supabaseAdmin
    .from('repositories')
    .select('id, user_id, full_name, name, source, pr_review_block_on_severity')
    .eq('id', repoId)
    .maybeSingle();
  if (repoErr || !repoRow) throw Object.assign(new Error('Repository not found'), { status: 404 });
  const fullName = repoRow.full_name || repoRow.name || '';
  if (repoRow.source !== 'github' || !fullName.includes('/')) {
    throw Object.assign(new Error('Only GitHub-connected repositories can publish PR reviews'), { status: 400 });
  }

  const githubToken = await getGithubTokenForUser(repoRow.user_id);
  if (!githubToken) throw Object.assign(new Error('Repository owner GitHub token is unavailable'), { status: 401 });

  const [owner, repo] = fullName.split('/');
  const octokit = getOctokit(githubToken);
  const findings = Array.isArray(review.findings_json) ? review.findings_json : [];
  const inlineFindings = findings.filter(hasInlineLocation);
  const severityCounts = review.severity_counts && typeof review.severity_counts === 'object'
    ? { ...getSeverityCounts([]), ...review.severity_counts }
    : getSeverityCounts(findings);
  const reviewLink = getCodeLensReviewLink(repoId, reviewId);
  const event = choosePrReviewEvent(findings, repoRow.pr_review_block_on_severity || 'critical');
  const comments = inlineFindings.map((finding) => ({
    path: getFindingPath(finding),
    line: getFindingLine(finding),
    side: 'RIGHT',
    body: buildInlineReviewComment(finding, reviewLink),
  }));
  const payload = {
    owner,
    repo,
    pull_number: review.pr_number,
    event,
    body: buildPrReviewBody({ review, findings, severityCounts, reviewLink }),
    comments,
  };

  await cleanupPreviousPrReviewComments({ octokit, owner, repo, repoId, review });
  await resetCurrentReviewComments({ octokit, owner, repo, review });

  let response;
  try {
    response = await octokit.rest.pulls.createReview(payload);
  } catch (err) {
    if ((err?.status || err?.response?.status) === 422 && retry422) {
      console.warn('[pr-review.publish] GitHub validation failed; dropping out-of-diff comments and retrying once:', err?.message || err);
      // A 422 usually means one or more inline comments target a line GitHub
      // does not consider part of the diff. Rebuild the diff line index, keep
      // only placeable comments, and retry once. Dropped findings remain in the
      // summary table built by buildPrReviewBody, so nothing is lost.
      let retryComments = payload.comments;
      try {
        const diffLineIndex = await fetchPrDiffLineIndex(octokit, owner, repo, review.pr_number);
        retryComments = (payload.comments || []).filter((comment) => lineExistsInDiff(diffLineIndex, comment.path, comment.line));
      } catch (diffErr) {
        console.warn('[pr-review.publish] could not rebuild diff index for retry:', diffErr?.message || diffErr);
      }
      await sleep(100);
      response = await octokit.rest.pulls.createReview({ ...payload, comments: retryComments });
    } else {
      throw err;
    }
  }

  const persisted = await persistPrReviewCommentIds({ octokit, owner, repo, review, reviewData: response?.data || {}, inlineFindings });
  return {
    ok: true,
    review_id: review.id,
    github_review_id: response?.data?.id || null,
    event,
    inline_comments: persisted.inlineCount,
    summary_items: persisted.summaryCount,
    actor_user_id: actorUserId,
  };
}

const publishPrReviewEndpoint = async (req, res) => {
  const { repoId, reviewId } = req.params;

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  try {
    const result = await publishPrReview({ repoId, reviewId, actorUserId: req.user.id });
    return res.json(result);
  } catch (err) {
    if (err?.status === 409) return res.status(409).json({ error: err.message, code: 'review_not_ready' });
    if (err?.status === 400) return res.status(400).json({ error: err.message, code: 'invalid_repository' });
    const mapped = mapPrPublishGithubError(err);
    console.error('[pr-review.publish] Failed:', err?.status || err?.response?.status, err?.message || err);
    return res.status(mapped.http).json({ error: mapped.message, code: mapped.code });
  }
};

// ─── US-076: CI status check ──────────────────────────────────────────────────

const CI_POLL_INTERVAL_MS = 3000;

function parseFailOnSeverity(raw) {
  const allowed = ['critical', 'high', 'medium', 'low'];
  const parsed = String(raw || 'critical,high')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => allowed.includes(value));
  return new Set(parsed.length ? parsed : ['critical', 'high']);
}

async function fetchLatestReviewForHead(repoId, prNumber, headSha) {
  const { data } = await supabaseAdmin
    .from('pr_reviews')
    .select('id, status, findings_json, severity_counts, total_findings, summary, pr_number, pr_head_sha')
    .eq('repo_id', repoId)
    .eq('pr_number', prNumber)
    .eq('pr_head_sha', headSha)
    .order('created_at', { ascending: false })
    .maybeSingle();
  return data || null;
}

// POST /api/repos/:repoId/pulls/:number/reviews/ci-check  (authenticated by a CI token).
// Blocks until the latest review for the PR head is ready (auto-triggering one if
// none exists), then returns pass/fail based on fail_on_severity.
const ciCheckReview = async (req, res) => {
  const repoId = req.ciAuth?.repoId || req.params.repoId;
  const prNumber = Number(req.params.number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return res.status(400).json({ error: 'Valid pull request number is required' });
  }

  const failOn = parseFailOnSeverity(req.body?.fail_on_severity ?? req.query?.fail_on_severity);
  const timeoutSeconds = Math.min(900, Math.max(30,
    Number(req.body?.wait_timeout_seconds ?? req.query?.wait_timeout_seconds) || 300));
  const deadline = Date.now() + timeoutSeconds * 1000;

  try {
    const { data: repoRow } = await supabaseAdmin
      .from('repositories')
      .select('id, user_id, full_name, name, source')
      .eq('id', repoId)
      .maybeSingle();
    if (!repoRow) return res.status(404).json({ error: 'Repository not found' });
    const fullName = repoRow.full_name || repoRow.name || '';
    if (repoRow.source !== 'github' || !fullName.includes('/')) {
      return res.status(400).json({ error: 'Only GitHub-connected repositories support CI checks' });
    }

    const githubToken = await getGithubTokenForUser(repoRow.user_id);
    if (!githubToken) return res.status(401).json({ error: 'Repository owner GitHub token is unavailable' });

    const [owner, repo] = fullName.split('/');
    const octokit = getOctokit(githubToken);
    const pr = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
    const headSha = pr.data.head.sha;

    let review = await fetchLatestReviewForHead(repoId, prNumber, headSha);

    // Auto-trigger when no usable review exists for this head SHA (CI may run
    // before the webhook fires, or webhooks may not be configured at all).
    if (!review || review.status === 'failed') {
      await runPrReviewBackground({ repoId, prNumber, owner, repo, githubToken, userId: repoRow.user_id, send: () => {} });
      review = await fetchLatestReviewForHead(repoId, prNumber, headSha);
    }

    // Otherwise a webhook-triggered run may still be in flight — poll until terminal.
    while (review && (review.status === 'analyzing' || review.status === 'pending')) {
      if (Date.now() >= deadline) break;
      await sleep(CI_POLL_INTERVAL_MS);
      review = await fetchLatestReviewForHead(repoId, prNumber, headSha);
    }

    const reviewLink = review ? getCodeLensReviewLink(repoId, review.id) : getCodeLensReviewLink(repoId, '');

    if (!review || review.status !== 'ready') {
      // Fail closed: a guardrail check should block when it cannot confirm a clean review.
      const summary = !review
        ? 'CodeLens could not produce a review for this pull request.'
        : review.status === 'failed'
          ? 'CodeLens PR review failed to complete.'
          : `CodeLens PR review did not finish within ${timeoutSeconds}s.`;
      return res.status(200).json({
        status: 'fail',
        severity_counts: normalizeSeverityCounts(review?.severity_counts || {}),
        summary_markdown: summary,
        codelens_url: reviewLink,
        timed_out: Boolean(review && review.status !== 'failed'),
      });
    }

    const findings = Array.isArray(review.findings_json) ? review.findings_json : [];
    const severityCounts = review.severity_counts && typeof review.severity_counts === 'object'
      ? normalizeSeverityCounts(review.severity_counts)
      : getSeverityCounts(findings);
    const failed = [...failOn].some((severity) => Number(severityCounts[severity] || 0) > 0);

    return res.status(200).json({
      status: failed ? 'fail' : 'pass',
      severity_counts: severityCounts,
      summary_markdown: buildPrReviewBody({ review, findings, severityCounts, reviewLink }),
      codelens_url: reviewLink,
    });
  } catch (err) {
    console.error('[pr-review.ci-check] Failed:', err?.status || err?.response?.status, err?.message || err);
    return res.status(502).json({ error: 'CI check failed to complete.' });
  }
};

function shortSha(value = '') {
  return String(value || '').slice(0, 7);
}

function normalizeSeverityCounts(counts = {}) {
  return {
    critical: Number(counts.critical || 0),
    high: Number(counts.high || 0),
    medium: Number(counts.medium || 0),
    low: Number(counts.low || 0),
  };
}

function hasBlockingFindings(review) {
  if (!review) return false;
  const counts = normalizeSeverityCounts(review.severity_counts || {});
  return counts.critical + counts.high > 0;
}

function derivePrReviewStatus(review) {
  if (!review) return 'not_analyzed';
  if (['ready', 'analyzing', 'failed', 'stale'].includes(review.status)) return review.status;
  if (review.status === 'pending') return 'analyzing';
  return 'not_analyzed';
}

async function fetchReviewRepo(reviewId) {
  const { data, error } = await supabaseAdmin
    .from('pr_reviews')
    .select('id, repo_id, pr_number, pr_head_sha, pr_base_sha, user_id, status, findings_json, summary, total_findings, severity_counts, created_at, updated_at, repositories!inner(id, user_id, full_name, name, source, pr_review_enabled, latest_indexed_sha)')
    .eq('id', reviewId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function githubCommentUrl(prUrl, commentId) {
  return prUrl && commentId ? `${prUrl}#discussion_r${commentId}` : null;
}

function attachCommentLinks(findings = [], comments = [], prUrl = '') {
  const byLocation = new Map();
  for (const comment of comments || []) {
    if (comment.kind !== 'inline') continue;
    const key = `${normalizeReviewFilePath(comment.file_path)}:${Number(comment.line_number || 0)}`;
    if (!byLocation.has(key)) byLocation.set(key, comment);
  }
  return findings.map((finding) => {
    const key = `${getFindingPath(finding)}:${Number(getFindingLine(finding) || 0)}`;
    const comment = byLocation.get(key);
    return {
      ...finding,
      github_comment_id: comment?.github_comment_id || null,
      github_url: githubCommentUrl(prUrl, comment?.github_comment_id),
    };
  });
}

async function getRepoForPulls(repoId) {
  const { data, error } = await supabaseAdmin
    .from('repositories')
    .select('id, user_id, full_name, name, source, pr_review_enabled, latest_indexed_sha')
    .eq('id', repoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function normalizeGithubPr(pr = {}) {
  return {
    number: pr.number,
    title: pr.title || `PR #${pr.number}`,
    html_url: pr.html_url || null,
    author: {
      login: pr.user?.login || 'unknown',
      avatar_url: pr.user?.avatar_url || null,
    },
    head_sha: pr.head?.sha || null,
    base_sha: pr.base?.sha || null,
    updated_at: pr.updated_at || null,
    state: pr.state || null,
  };
}

function normalizeLatestReview(review) {
  if (!review) return null;
  return {
    id: review.id,
    status: review.status,
    pr_head_sha: review.pr_head_sha,
    pr_base_sha: review.pr_base_sha,
    summary: review.summary,
    total_findings: Number(review.total_findings || 0),
    severity_counts: normalizeSeverityCounts(review.severity_counts || {}),
    created_at: review.created_at,
    updated_at: review.updated_at,
  };
}

// GET /api/repos/:repoId/pulls
const listPullRequests = async (req, res) => {
  const { repoId } = req.params;
  const state = req.query.state === 'all' ? 'all' : 'open';
  const findings = ['has_findings', 'clean'].includes(req.query.findings) ? req.query.findings : 'all';
  const author = String(req.query.author || '').trim();

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  try {
    const repoRow = await getRepoForPulls(repoId);
    if (!repoRow) return res.status(404).json({ error: 'Repository not found or unauthorized' });
    if (repoRow.source !== 'github') {
      return res.json({ pr_review_enabled: Boolean(repoRow.pr_review_enabled), pulls: [], authors: [] });
    }

    const fullName = repoRow.full_name || repoRow.name || '';
    if (!fullName.includes('/')) return res.status(400).json({ error: 'Repository metadata missing full_name' });

    const githubToken = await getGithubTokenForUser(repoRow.user_id);
    if (!githubToken) return res.status(401).json({ error: 'Repository owner GitHub token is unavailable' });

    const [owner, repo] = fullName.split('/');
    const octokit = getOctokit(githubToken);
    const { data: githubPulls } = await octokit.rest.pulls.list({
      owner,
      repo,
      state,
      sort: 'updated',
      direction: 'desc',
      per_page: 50,
    });

    const prNumbers = (githubPulls || []).map((pr) => pr.number);
    let latestReviews = new Map();
    if (prNumbers.length > 0) {
      const { data: reviews, error } = await supabaseAdmin
        .from('pr_reviews')
        .select('id, repo_id, pr_number, pr_head_sha, pr_base_sha, status, summary, total_findings, severity_counts, created_at, updated_at')
        .eq('repo_id', repoId)
        .in('pr_number', prNumbers)
        .order('created_at', { ascending: false });
      if (error) throw error;
      for (const review of reviews || []) {
        if (!latestReviews.has(review.pr_number)) latestReviews.set(review.pr_number, review);
      }
    }

    let authors = [];
    try {
      const { data: contributors } = await octokit.rest.repos.listContributors({
        owner,
        repo,
        per_page: 100
      });
      authors = (contributors || []).map((c) => c.login).filter(Boolean).sort();
    } catch (contribErr) {
      console.warn('[pulls.list] Failed to fetch contributors:', contribErr.message);
      authors = [...new Set((githubPulls || []).map((pr) => pr.user?.login).filter(Boolean))].sort();
    }
    let pulls = (githubPulls || []).map((pr) => {
      const latest = latestReviews.get(pr.number) || null;
      return {
        ...normalizeGithubPr(pr),
        review_status: derivePrReviewStatus(latest),
        latest_review: normalizeLatestReview(latest),
      };
    });

    if (author) pulls = pulls.filter((pr) => pr.author.login === author);
    if (findings === 'has_findings') pulls = pulls.filter((pr) => Number(pr.latest_review?.total_findings || 0) > 0);
    if (findings === 'clean') pulls = pulls.filter((pr) => pr.latest_review && Number(pr.latest_review.total_findings || 0) === 0);

    pulls.sort((a, b) => {
      const aRisk = hasBlockingFindings(a.latest_review) ? 1 : 0;
      const bRisk = hasBlockingFindings(b.latest_review) ? 1 : 0;
      if (aRisk !== bRisk) return bRisk - aRisk;
      return new Date(b.updated_at || b.latest_review?.updated_at || 0) - new Date(a.updated_at || a.latest_review?.updated_at || 0);
    });

    res.set('Cache-Control', 'private, max-age=15');
    res.json({ pr_review_enabled: Boolean(repoRow.pr_review_enabled), pulls, authors });
  } catch (err) {
    console.error('[pulls.list] Failed:', err.message || err);
    res.status(500).json({ error: `Failed to fetch pull requests: ${err.message || 'Unknown error'}` });
  }
};

// GET /api/repos/:repoId/pulls/:number/reviews
const listPullRequestReviews = async (req, res) => {
  const { repoId, number } = req.params;
  const prNumber = Number(number);
  if (!Number.isInteger(prNumber) || prNumber <= 0) return res.status(400).json({ error: 'Valid pull request number is required' });

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const { data, error } = await supabaseAdmin
    .from('pr_reviews')
    .select('id, repo_id, pr_number, pr_head_sha, pr_base_sha, status, summary, total_findings, severity_counts, created_at, updated_at')
    .eq('repo_id', repoId)
    .eq('pr_number', prNumber)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Failed to fetch PR review history' });
  res.json({ reviews: (data || []).map(normalizeLatestReview) });
};

// GET /api/reviews/:reviewId
const getPrReviewDetail = async (req, res) => {
  const { reviewId } = req.params;
  try {
    const review = await fetchReviewRepo(reviewId);
    if (!review) return res.status(404).json({ error: 'PR review not found' });
    const repoRow = review.repositories;
    const allowed = await canAccessRepo(review.repo_id, req.user.id);
    if (!allowed) return res.status(404).json({ error: 'PR review not found' });

    const fullName = repoRow.full_name || repoRow.name || '';
    let pr = null;
    if (repoRow.source === 'github' && fullName.includes('/')) {
      const githubToken = await getGithubTokenForUser(repoRow.user_id);
      if (githubToken) {
        try {
          const [owner, repo] = fullName.split('/');
          const response = await getOctokit(githubToken).rest.pulls.get({ owner, repo, pull_number: review.pr_number });
          pr = normalizeGithubPr(response.data || {});
        } catch (err) {
          console.warn('[reviews.detail] Failed to fetch GitHub PR:', err.message);
        }
      }
    }

    const { data: comments, error: commentsErr } = await supabaseAdmin
      .from('pr_review_comments')
      .select('id, review_id, github_comment_id, file_path, line_number, kind, created_at')
      .eq('review_id', review.id);
    if (commentsErr) throw commentsErr;
    const { data: suppressions, error: suppressionsErr } = await supabaseAdmin
      .from('issue_suppressions')
      .select('file_path, rule_id, line_number')
      .eq('repo_id', review.repo_id);
    if (suppressionsErr) throw suppressionsErr;

    const summaryComment = (comments || []).find((comment) => comment.kind === 'summary');
    const prUrl = pr?.html_url || null;
    const suppressedSet = new Set((suppressions || []).flatMap(buildSuppressionKeys));
    const rawFindings = (Array.isArray(review.findings_json) ? review.findings_json : [])
      .filter((finding) => !isSuppressedFinding(finding, suppressedSet));
    const findings = attachCommentLinks(rawFindings, comments || [], prUrl);
    const visibleSeverityCounts = getSeverityCounts(findings);
    const indexedSha = repoRow.latest_indexed_sha || null;
    const staleIndex = {
      is_stale: Boolean(indexedSha && review.pr_head_sha && indexedSha !== review.pr_head_sha),
      indexed_sha: indexedSha,
      pr_head_sha: review.pr_head_sha,
    };

    res.json({
      review: {
        id: review.id,
        repo_id: review.repo_id,
        pr_number: review.pr_number,
        pr_head_sha: review.pr_head_sha,
        pr_base_sha: review.pr_base_sha,
        head_sha_short: shortSha(review.pr_head_sha),
        base_sha_short: shortSha(review.pr_base_sha),
        status: review.status,
        summary: review.summary,
        total_findings: findings.length,
        severity_counts: visibleSeverityCounts,
        created_at: review.created_at,
        updated_at: review.updated_at,
        findings_json: findings,
        github_review_id: summaryComment?.github_comment_id || null,
        github_review_url: githubCommentUrl(prUrl, summaryComment?.github_comment_id),
      },
      repo: { id: repoRow.id, full_name: fullName, pr_review_enabled: Boolean(repoRow.pr_review_enabled) },
      pull_request: pr || {
        number: review.pr_number,
        title: `PR #${review.pr_number}`,
        html_url: null,
        author: { login: 'unknown', avatar_url: null },
        head_sha: review.pr_head_sha,
        base_sha: review.pr_base_sha,
      },
      stale_index: staleIndex,
      comments: comments || [],
    });
  } catch (err) {
    console.error('[reviews.detail] Failed:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch PR review detail' });
  }
};

// ─── US-064: Refactor proposal generation ─────────────────────────────────────

const PROPOSAL_MAX_TOKENS = 4000;

const generatePrFindingProposal = async (req, res) => {
  const { repoId } = req.params;
  const regenerate = String(req.query?.regenerate || req.body?.regenerate || '').toLowerCase() === 'true';
  const { review_id, finding_id, finding } = req.body || {};
  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });
  if (!review_id || !finding_id || !finding) return res.status(400).json({ error: 'review_id, finding_id, and finding are required' });

  const review = await fetchReviewRepo(review_id);
  if (!review || review.repo_id !== repoId) return res.status(404).json({ error: 'PR review not found' });

  openSse(res);
  const send = sendFactory(res);

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      send({ type: 'error', message: 'Proposal generation requires the Anthropic API key.' });
      return res.end();
    }

    if (!regenerate) {
      const { data: cached } = await supabaseAdmin
        .from('pr_finding_proposals')
        .select('id, proposal_json, prompt_tokens, completion_tokens')
        .eq('review_id', review_id)
        .eq('finding_id', finding_id)
        .eq('user_id', req.user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cached?.proposal_json) {
        emitProposalEvents(send, cached.proposal_json);
        send({
          type: 'done',
          proposal_id: cached.id,
          cached: true,
          prompt_tokens: cached.prompt_tokens || 0,
          completion_tokens: cached.completion_tokens || 0,
        });
        return res.end();
      }
    }

    const filePath = getFindingPath(finding);
    const line = getFindingLine(finding);
    const source = filePath ? clipFile(await fetchFileSource(repoId, filePath) || '', 12000) : '';
    const system = PROPOSAL_SYSTEM_BASE + ' Specifically: generate the smallest safe fix for a deterministic pull request review finding. Keep the proposal scoped to the PR finding and include full file contents for every create/modify change.';
    const user = [
      `PR review: ${review_id}`,
      `Finding id: ${finding_id}`,
      `Rule: ${getFindingRuleId(finding) || 'unknown'}`,
      `Severity: ${finding.severity || 'medium'}`,
      `Location: ${filePath || 'summary'}${line ? `:${line}` : ''}`,
      `Message: ${getPrFindingMessage(finding)}`,
      finding.blast_radius ? `Blast radius: ${JSON.stringify(finding.blast_radius)}` : '',
      '',
      filePath ? `File content:\n\`\`\`\n${source}\n\`\`\`` : '',
    ].filter(Boolean).join('\n');

    const { signal, cleanup } = bindRequestAbort(req);
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let summaryEmitted = '';
    let aborted = false;
    try {
      const stream = await anthropic.messages.create({
        model: MODEL,
        max_tokens: PROPOSAL_MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
        stream: true,
      }, { signal });

      for await (const event of stream) {
        if (event.type === 'message_start') inputTokens = event.message?.usage?.input_tokens || 0;
        else if (event.type === 'message_delta') outputTokens = event.usage?.output_tokens || outputTokens;
        else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          text += event.delta.text;
          const currentSummary = extractStreamingSummary(text);
          if (currentSummary && currentSummary.length > summaryEmitted.length) {
            const delta = currentSummary.slice(summaryEmitted.length);
            summaryEmitted = currentSummary;
            send({ type: 'summary_delta', delta });
          }
        }
      }
    } catch (streamErr) {
      if (isAbortError(streamErr, signal)) aborted = true;
      else throw streamErr;
    } finally {
      cleanup();
    }

    await recordUsage({
      userId: req.user.id,
      endpoint: 'pr_finding_proposal_generation',
      provider: 'anthropic',
      promptTokens: inputTokens,
      completionTokens: outputTokens,
    });

    if (aborted) return res.end();
    const parsed = parseProposalJson(text);
    if (!parsed) {
      send({ type: 'error', message: 'Could not parse a structured proposal from the model output.' });
      return res.end();
    }

    if (!summaryEmitted && parsed.summary) send({ type: 'summary_delta', delta: parsed.summary });
    if (parsed.rationale) send({ type: 'rationale_delta', delta: parsed.rationale });
    for (const change of parsed.changes) send({ type: 'change', change });
    for (const risk of parsed.risks) send({ type: 'risk', risk });

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('pr_finding_proposals')
      .insert({
        review_id,
        finding_id,
        user_id: req.user.id,
        status: 'pending',
        proposal_json: parsed,
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
      })
      .select('id')
      .single();
    if (insErr) {
      console.warn('[pr-finding-proposals] Failed to persist proposal:', insErr.message);
      send({ type: 'error', message: 'Could not save the generated proposal.' });
      return res.end();
    }

    send({ type: 'done', proposal_id: inserted.id, prompt_tokens: inputTokens, completion_tokens: outputTokens });
    return res.end();
  } catch (err) {
    console.error('[pr-finding-proposals] Unhandled error:', err);
    try {
      send({ type: 'error', message: 'An unexpected error occurred generating the proposal.' });
      res.end();
    } catch {
      res.end();
    }
  }
};

const updatePrFindingProposalStatus = async (req, res) => {
  const { repoId, proposalId } = req.params;
  const { status } = req.body || {};
  if (!['discarded'].includes(status)) return res.status(400).json({ error: 'Unsupported proposal status' });
  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const { data, error } = await supabaseAdmin
    .from('pr_finding_proposals')
    .update({ status })
    .eq('id', proposalId)
    .eq('user_id', req.user.id)
    .select('id, status, pr_reviews!inner(repo_id)')
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'Failed to update proposal status' });
  if (!data || data.pr_reviews?.repo_id !== repoId) return res.status(404).json({ error: 'Proposal not found' });
  res.json({ ok: true, proposal: { id: data.id, status: data.status } });
};

const applyPrFindingProposalAsPr = async (req, res) => {
  const { repoId, proposalId } = req.params;
  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const { data: proposal, error: propErr } = await supabaseAdmin
    .from('pr_finding_proposals')
    .select('id, review_id, finding_id, user_id, status, proposal_json, branch_name, pr_url, pr_reviews!inner(repo_id, pr_number)')
    .eq('id', proposalId)
    .eq('user_id', req.user.id)
    .maybeSingle();
  if (propErr) return res.status(500).json({ error: 'Failed to load proposal' });
  if (!proposal || proposal.pr_reviews?.repo_id !== repoId) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.status === 'discarded' || proposal.status === 'stale') {
    return res.status(409).json({ error: `Cannot apply a ${proposal.status} proposal — regenerate it first.` });
  }
  if (proposal.status === 'applied' && proposal.pr_url && proposal.branch_name) {
    return res.json({ branch_name: proposal.branch_name, pr_url: proposal.pr_url, reused: true });
  }

  const payload = proposal.proposal_json || {};
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  if (changes.length === 0) return res.status(422).json({ error: 'Proposal has no changes to apply.' });
  for (const change of changes) {
    if ((change.action === 'create' || change.action === 'modify') && !String(change.full_content || '').trim()) {
      return res.status(422).json({ error: 'This proposal is missing file contents; please regenerate it.' });
    }
  }

  const { data: repoRow, error: repoErr } = await supabaseAdmin
    .from('repositories')
    .select('id, full_name, default_branch, source')
    .eq('id', repoId)
    .single();
  if (repoErr || !repoRow) return res.status(404).json({ error: 'Repository not found' });
  if (repoRow.source !== 'github' || !repoRow.full_name || !repoRow.full_name.includes('/')) {
    return res.status(400).json({ error: 'Only GitHub-connected repositories support Apply via PR.' });
  }

  const githubToken = await getGithubTokenForUser(req.user.id);
  if (!githubToken) return res.status(401).json({ error: 'Your GitHub token has expired. Reconnect GitHub from Settings.' });

  const [owner, repoName] = repoRow.full_name.split('/');
  const octokit = getOctokit(githubToken);
  const primaryPath = changes[0]?.file_path || 'pr-finding';
  const slug = buildBranchSlug('pr-finding', primaryPath);
  const branchName = `codelens/refactor/${String(proposalId).slice(0, 8)}-${slug}`;

  try {
    let defaultBranch = repoRow.default_branch;
    if (!defaultBranch) {
      const { data: repoMeta } = await octokit.rest.repos.get({ owner, repo: repoName });
      defaultBranch = repoMeta.default_branch;
    }
    const { data: baseRef } = await octokit.rest.git.getRef({ owner, repo: repoName, ref: `heads/${defaultBranch}` });
    const baseSha = baseRef.object.sha;
    const { data: baseCommit } = await octokit.rest.git.getCommit({ owner, repo: repoName, commit_sha: baseSha });
    const treeEntries = [];
    for (const change of changes) {
      if (change.action === 'create' || change.action === 'modify') {
        const { data: blob } = await octokit.rest.git.createBlob({ owner, repo: repoName, content: change.full_content, encoding: 'utf-8' });
        treeEntries.push({ path: change.file_path, mode: '100644', type: 'blob', sha: blob.sha });
      } else if (change.action === 'delete') {
        treeEntries.push({ path: change.file_path, mode: '100644', type: 'blob', sha: null });
      }
    }
    const { data: newTree } = await octokit.rest.git.createTree({ owner, repo: repoName, base_tree: baseCommit.tree.sha, tree: treeEntries });
    const { data: commit } = await octokit.rest.git.createCommit({
      owner,
      repo: repoName,
      message: ((payload.summary && String(payload.summary).trim()) || `Refactor: ${slug}`).slice(0, 4096),
      tree: newTree.sha,
      parents: [baseSha],
    });

    let branchExists = false;
    try {
      await octokit.rest.git.createRef({ owner, repo: repoName, ref: `refs/heads/${branchName}`, sha: commit.sha });
    } catch (refErr) {
      if (refErr?.status === 422) branchExists = true;
      else throw refErr;
    }

    let prUrl;
    if (branchExists) {
      const existing = await findExistingOpenPr(octokit, owner, repoName, branchName);
      if (existing) prUrl = existing.html_url;
      else await octokit.rest.git.updateRef({ owner, repo: repoName, ref: `heads/${branchName}`, sha: commit.sha, force: true });
    }
    if (!prUrl) {
      const { data: pr } = await octokit.rest.pulls.create({
        owner,
        repo: repoName,
        draft: true,
        head: branchName,
        base: defaultBranch,
        title: `Refactor: ${(payload.summary || slug).trim()}`.slice(0, 72),
        body: buildPrBody({
          rationale: payload.rationale,
          risks: payload.risks,
          repoId,
          issueId: `pr-review-${proposal.review_id}-${proposal.finding_id}`,
          proposalId,
          issueType: 'pr_review_finding',
        }),
      });
      prUrl = pr.html_url;
    }

    await supabaseAdmin
      .from('pr_finding_proposals')
      .update({ status: 'applied', branch_name: branchName, pr_url: prUrl, updated_at: new Date().toISOString() })
      .eq('id', proposalId)
      .eq('user_id', req.user.id);
    return res.json({ branch_name: branchName, pr_url: prUrl, reused: false });
  } catch (err) {
    const { http, message } = mapGithubError(err);
    console.error('[pr-finding-proposals.apply] Failed:', err?.status, err?.message);
    return res.status(http).json({ error: message });
  }
};
const PROPOSAL_FILE_BUDGET_CHARS = 30000; // ≈ 7.5k tokens per file
const PROPOSAL_NEIGHBOUR_LIMIT = 5;
const PROPOSAL_IMPORTERS_LIMIT = 30;

const PROPOSAL_SYSTEM_BASE = [
  'You are a senior engineer proposing a concrete code refactor.',
  'Output a single JSON object matching this exact schema:',
  '{ "summary": string, "rationale": string, "changes": [{ "file_path": string, "action": "create"|"modify"|"delete", "diff": string, "full_content": string }], "risks": string[] }',
  'Return ONLY the JSON object. No commentary, no markdown fences, no prose around it.',
  'Diffs MUST be in unified format (--- a/path, +++ b/path, @@ hunks).',
  'For create and modify actions, include the entire resulting file as full_content.',
  'For delete actions, leave full_content empty and explain in risks.',
  'List in risks anything the static analysis could miss (reflection, dynamic imports, runtime DI).',
].join(' ');

async function fetchAnalysisIssue(repoId, issueId) {
  const { data, error } = await supabaseAdmin
    .from('analysis_issues')
    .select('id, repo_id, type, severity, file_paths, description')
    .eq('id', issueId)
    .eq('repo_id', repoId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function fetchCachedPendingProposal(issueId, userId) {
  const { data } = await supabaseAdmin
    .from('issue_proposals')
    .select('id, proposal_json, prompt_tokens, completion_tokens, created_at')
    .eq('issue_id', issueId)
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

function clipFile(source, limit = PROPOSAL_FILE_BUDGET_CHARS) {
  if (!source) return '';
  if (source.length <= limit) return source;
  return source.slice(0, limit) + '\n/* [CodeLens] truncated for context budget */';
}

async function buildGodFileContext(issue, repoId, filePath) {
  const source = clipFile(await fetchFileSource(repoId, filePath) || '');

  const { data: importers } = await supabaseAdmin
    .from('graph_edges')
    .select('from_path, symbols')
    .eq('repo_id', repoId)
    .eq('to_path', filePath);

  const ranked = (importers || []).slice().sort((a, b) => {
    const al = Array.isArray(a.symbols) ? a.symbols.length : 0;
    const bl = Array.isArray(b.symbols) ? b.symbols.length : 0;
    return bl - al;
  });

  const importerLines = ranked.slice(0, PROPOSAL_IMPORTERS_LIMIT).map((r) => {
    const syms = (Array.isArray(r.symbols) ? r.symbols : []).filter(Boolean);
    return syms.length > 0
      ? `- ${r.from_path}: uses ${syms.join(', ')}`
      : `- ${r.from_path}: (no symbol tracking on this edge)`;
  }).join('\n');

  const system = PROPOSAL_SYSTEM_BASE + ' Specifically: split a god file into focused modules, minimising cross-cuts based on which symbols each importer actually uses. For backward compatibility, the original file should re-export from the new files unless explicitly safe to break.';
  const user = [
    `File flagged as a god file: ${filePath}`,
    issue.description ? `Issue description: ${issue.description}` : '',
    '',
    'Importers and the symbols each one uses:',
    importerLines || '(no importers found)',
    '',
    'Current file content:',
    '```',
    source,
    '```',
  ].filter(Boolean).join('\n');
  return { system, user };
}

async function buildCircularContext(issue, repoId) {
  const paths = Array.isArray(issue.file_paths) ? issue.file_paths : [];
  const fileBlocks = [];
  for (const p of paths.slice(0, 6)) {
    const src = await fetchFileSource(repoId, p);
    const trimmed = clipFile(src || '(file content unavailable)', 8000);
    fileBlocks.push(`--- ${p} ---\n${trimmed}`);
  }

  let edges = [];
  if (paths.length > 0) {
    const { data } = await supabaseAdmin
      .from('graph_edges')
      .select('from_path, to_path, symbols')
      .eq('repo_id', repoId)
      .in('from_path', paths)
      .in('to_path', paths);
    edges = data || [];
  }

  const edgeLines = edges.map((e) => {
    const syms = Array.isArray(e.symbols) && e.symbols.length > 0 ? ` (${e.symbols.join(', ')})` : '';
    return `- ${e.from_path} → ${e.to_path}${syms}`;
  }).join('\n');

  const system = PROPOSAL_SYSTEM_BASE + ' Specifically: break a circular import cycle with the cheapest possible cut — usually extracting a shared dependency into a new file, moving one symbol, or inverting a dependency.';
  const user = [
    `Circular dependency involves: ${paths.join(', ')}`,
    issue.description ? `Issue description: ${issue.description}` : '',
    '',
    'Edges between these files (importer → importee, symbols where known):',
    edgeLines || '(no edges captured)',
    '',
    'File contents:',
    fileBlocks.join('\n\n'),
  ].filter(Boolean).join('\n');
  return { system, user };
}

async function buildHighCouplingContext(issue, repoId, filePath) {
  const source = clipFile(await fetchFileSource(repoId, filePath) || '');

  const { data: outEdges } = await supabaseAdmin
    .from('graph_edges')
    .select('to_path, symbols')
    .eq('repo_id', repoId)
    .eq('from_path', filePath);
  const { data: inEdges } = await supabaseAdmin
    .from('graph_edges')
    .select('from_path, symbols')
    .eq('repo_id', repoId)
    .eq('to_path', filePath);

  const neighbourMap = new Map();
  for (const e of (outEdges || [])) {
    const n = neighbourMap.get(e.to_path) || { path: e.to_path, count: 0, symbols: new Set() };
    n.count += 1;
    (e.symbols || []).forEach((s) => n.symbols.add(s));
    neighbourMap.set(e.to_path, n);
  }
  for (const e of (inEdges || [])) {
    const n = neighbourMap.get(e.from_path) || { path: e.from_path, count: 0, symbols: new Set() };
    n.count += 1;
    (e.symbols || []).forEach((s) => n.symbols.add(s));
    neighbourMap.set(e.from_path, n);
  }
  const top = [...neighbourMap.values()].sort((a, b) => b.count - a.count).slice(0, PROPOSAL_NEIGHBOUR_LIMIT);
  const lines = top.map((n) => `- ${n.path}${n.symbols.size > 0 ? ` (symbols: ${[...n.symbols].join(', ')})` : ''}`).join('\n');

  const system = PROPOSAL_SYSTEM_BASE + ' Specifically: reduce coupling by introducing an interface, narrowing the API surface, or relocating responsibilities.';
  const user = [
    `High coupling on file: ${filePath}`,
    issue.description ? `Issue description: ${issue.description}` : '',
    '',
    `Top ${PROPOSAL_NEIGHBOUR_LIMIT} most-coupled neighbours:`,
    lines || '(no neighbours identified)',
    '',
    'File content:',
    '```',
    source,
    '```',
  ].filter(Boolean).join('\n');
  return { system, user };
}

async function buildDeadCodeContext(issue, repoId, filePath) {
  const source = clipFile(await fetchFileSource(repoId, filePath) || '');
  const { data: incoming } = await supabaseAdmin
    .from('graph_edges')
    .select('from_path')
    .eq('repo_id', repoId)
    .eq('to_path', filePath);

  const system = PROPOSAL_SYSTEM_BASE + ' Specifically: remove dead code. Use action "delete" for files that should be removed entirely. Flag reflection / dynamic-import callers as risks since the static graph could miss them.';
  const user = [
    `Dead code candidate: ${filePath}`,
    `Static incoming edges: ${(incoming || []).length}`,
    issue.description ? `Issue description: ${issue.description}` : '',
    '',
    'Current file content:',
    '```',
    source,
    '```',
  ].filter(Boolean).join('\n');
  return { system, user };
}

async function buildMissingAuthContext(issue, repoId, filePath) {
  const source = clipFile(await fetchFileSource(repoId, filePath) || '');
  const system = PROPOSAL_SYSTEM_BASE + ' Specifically: add auth protection to an unauthenticated route handler. Re-use the same middleware/decorator pattern the rest of the file already uses for authenticated routes if one is visible. If no auth helper is imported, propose a minimal import based on the file\'s existing dependencies.';
  const user = [
    `Route handler file with unauthenticated routes: ${filePath}`,
    issue.description ? `Issue description (lists the unauthenticated paths): ${issue.description}` : '',
    '',
    'File content:',
    '```',
    source,
    '```',
  ].filter(Boolean).join('\n');
  return { system, user };
}

async function buildHardcodedSecretContext(issue, repoId, filePath) {
  const source = await fetchFileSource(repoId, filePath) || '';
  const lineMatch = String(issue.description || '').match(/line\s+(\d+)/i);
  const line = lineMatch ? Number(lineMatch[1]) : null;

  let snippet;
  if (line) {
    const lines = source.split('\n');
    const start = Math.max(0, line - 11);
    const end = Math.min(lines.length, line + 10);
    snippet = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
  } else {
    snippet = clipFile(source, 8000);
  }

  const envExample = await fetchFileSource(repoId, '.env.example');

  const system = PROPOSAL_SYSTEM_BASE + ' Specifically: replace a hardcoded secret with a runtime read from environment configuration. NEVER repeat the original secret value verbatim. Add the new key to .env.example if it is provided, otherwise list it in risks.';
  const user = [
    `File with hardcoded secret: ${filePath}`,
    issue.description ? `Issue description: ${issue.description}` : '',
    line ? `Secret is on line ${line} (±10 lines below).` : '',
    '',
    'Source snippet:',
    '```',
    snippet,
    '```',
    envExample ? `\nExisting .env.example:\n\`\`\`\n${clipFile(envExample, 4000)}\n\`\`\`` : '\n(.env.example not found in repo)',
  ].filter(Boolean).join('\n');
  return { system, user };
}

async function buildVulnDependencyContext(issue, repoId, filePath) {
  const source = filePath ? clipFile(await fetchFileSource(repoId, filePath) || '', 12000) : '';
  const system = PROPOSAL_SYSTEM_BASE + ' Specifically: a dependency in this manifest has a known vulnerability. Propose the safe upgrade. For lockfiles, only describe the version change in the diff and list re-generation steps in risks — do not invent a full lockfile diff.';
  const user = [
    `Vulnerable dependency in: ${filePath || '(unknown manifest)'}`,
    issue.description ? `Issue description: ${issue.description}` : '',
    '',
    filePath ? `Manifest content:\n\`\`\`\n${source}\n\`\`\`` : '',
  ].filter(Boolean).join('\n');
  return { system, user };
}

async function buildGenericContext(issue, repoId, filePath) {
  const source = filePath ? clipFile(await fetchFileSource(repoId, filePath) || '') : '';
  const user = [
    `Issue type: ${issue.type}`,
    `Affected file: ${filePath || '(none)'}`,
    `Severity: ${issue.severity || 'unknown'}`,
    `Description: ${issue.description || '(no description)'}`,
    filePath ? `\nFile content:\n\`\`\`\n${source}\n\`\`\`` : '',
  ].filter(Boolean).join('\n');
  return { system: PROPOSAL_SYSTEM_BASE, user };
}

async function buildContextForIssue(issue, repoId) {
  const primary = Array.isArray(issue.file_paths) ? issue.file_paths[0] : null;
  switch (issue.type) {
    case 'god_file':              return buildGodFileContext(issue, repoId, primary);
    case 'circular_dependency':   return buildCircularContext(issue, repoId);
    case 'high_coupling':         return buildHighCouplingContext(issue, repoId, primary);
    case 'dead_code':             return buildDeadCodeContext(issue, repoId, primary);
    case 'missing_auth':          return buildMissingAuthContext(issue, repoId, primary);
    case 'hardcoded_secret':      return buildHardcodedSecretContext(issue, repoId, primary);
    case 'vulnerable_dependency': return buildVulnDependencyContext(issue, repoId, primary);
    default:                      return buildGenericContext(issue, repoId, primary);
  }
}

function extractStreamingSummary(text) {
  const match = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!match) return '';
  // Unescape in the correct JSON order: collapse `\\` first via a sentinel so
  // that a literal backslash followed by `n` (e.g. a Windows path) isn't
  // mis-interpreted as a newline escape.
  return match[1]
    .replace(/\\\\/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(//g, '\\');
}

function normalizeChange(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = String(raw.action || '').toLowerCase();
  if (!['create', 'modify', 'delete'].includes(action)) return null;
  const filePath = String(raw.file_path || '').trim();
  if (!filePath) return null;
  return {
    file_path: filePath,
    action,
    diff: typeof raw.diff === 'string' ? raw.diff : '',
    full_content: typeof raw.full_content === 'string' ? raw.full_content : '',
  };
}

function normalizeProposal(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const changes = Array.isArray(parsed.changes) ? parsed.changes.map(normalizeChange).filter(Boolean) : [];
  const risks   = Array.isArray(parsed.risks) ? parsed.risks.map((r) => String(r).trim()).filter(Boolean) : [];

  // The apply-as-PR endpoint commits change.full_content verbatim, so any
  // create/modify missing it would silently produce an empty file. Surface
  // those as risks here rather than letting the user discover them on Apply.
  for (const change of changes) {
    if ((change.action === 'create' || change.action === 'modify') && !change.full_content.trim()) {
      risks.push(`Proposed ${change.action} of ${change.file_path} is missing file contents — cannot be applied as a PR. Regenerate the proposal.`);
    }
  }

  return {
    summary:   String(parsed.summary || '').trim(),
    rationale: String(parsed.rationale || '').trim(),
    changes,
    risks,
  };
}

function parseProposalJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1].trim(), trimmed] : [trimmed];
  for (const candidate of candidates) {
    try {
      return normalizeProposal(JSON.parse(candidate));
    } catch {
      // Try the next candidate.
    }
  }

  // Last-resort: extract the largest brace-balanced JSON substring.
  const start = trimmed.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    if (trimmed[i] === '{') depth++;
    else if (trimmed[i] === '}') {
      depth--;
      if (depth === 0) {
        try {
          return normalizeProposal(JSON.parse(trimmed.slice(start, i + 1)));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function emitProposalEvents(send, proposal) {
  if (!proposal) return;
  if (proposal.summary) send({ type: 'summary_delta', delta: proposal.summary });
  if (proposal.rationale) send({ type: 'rationale_delta', delta: proposal.rationale });
  for (const change of (proposal.changes || [])) send({ type: 'change', change });
  for (const risk of (proposal.risks || [])) send({ type: 'risk', risk });
}

const generateProposal = async (req, res) => {
  const { repoId, issueId } = req.params;
  const regenerate = String(req.query?.regenerate || '').toLowerCase() === 'true';

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const issue = await fetchAnalysisIssue(repoId, issueId);
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  openSse(res);
  const send = sendFactory(res);

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      send({ type: 'error', message: 'Proposal generation requires the Anthropic API key.' });
      return res.end();
    }

    if (!regenerate) {
      const cached = await fetchCachedPendingProposal(issueId, req.user.id);
      if (cached?.proposal_json) {
        emitProposalEvents(send, cached.proposal_json);
        send({
          type: 'done',
          proposal_id: cached.id,
          cached: true,
          prompt_tokens: cached.prompt_tokens || 0,
          completion_tokens: cached.completion_tokens || 0,
        });
        return res.end();
      }
    }

    const { system, user } = await buildContextForIssue(issue, repoId);
    const { signal, cleanup } = bindRequestAbort(req);

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let summaryEmitted = '';
    let aborted = false;

    try {
      const stream = await anthropic.messages.create({
        model: MODEL,
        max_tokens: PROPOSAL_MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: user }],
        stream: true,
      }, { signal });

      for await (const event of stream) {
        if (event.type === 'message_start') {
          inputTokens = event.message?.usage?.input_tokens || 0;
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage?.output_tokens || outputTokens;
        } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          text += event.delta.text;
          const currentSummary = extractStreamingSummary(text);
          if (currentSummary && currentSummary.length > summaryEmitted.length) {
            const delta = currentSummary.slice(summaryEmitted.length);
            summaryEmitted = currentSummary;
            send({ type: 'summary_delta', delta });
          }
        }
      }
    } catch (streamErr) {
      if (isAbortError(streamErr, signal)) {
        aborted = true;
        console.warn(`[proposals] Claude stream aborted by client disconnect (issue=${issueId}, partial_output_tokens=${outputTokens})`);
      } else {
        throw streamErr;
      }
    } finally {
      cleanup();
    }

    await recordUsage({
      userId: req.user.id,
      endpoint: 'proposal_generation',
      provider: 'anthropic',
      promptTokens: inputTokens,
      completionTokens: outputTokens,
    });

    if (aborted) return res.end();

    const parsed = parseProposalJson(text);
    if (!parsed) {
      send({ type: 'error', message: 'Could not parse a structured proposal from the model output.' });
      return res.end();
    }

    // If we never streamed any summary text (model emitted summary after other fields), send it now.
    if (!summaryEmitted && parsed.summary) {
      send({ type: 'summary_delta', delta: parsed.summary });
    }
    if (parsed.rationale) send({ type: 'rationale_delta', delta: parsed.rationale });
    for (const change of parsed.changes) send({ type: 'change', change });
    for (const risk of parsed.risks) send({ type: 'risk', risk });

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('issue_proposals')
      .insert({
        issue_id: issueId,
        user_id: req.user.id,
        status: 'pending',
        proposal_json: parsed,
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
      })
      .select('id')
      .single();

    if (insErr) {
      console.warn('[proposals] Failed to persist proposal:', insErr.message);
      send({ type: 'error', message: 'Could not save the generated proposal.' });
      return res.end();
    }

    send({
      type: 'done',
      proposal_id: inserted.id,
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
    });
    res.end();
  } catch (err) {
    console.error('[proposals] Unhandled error:', err);
    try {
      send({ type: 'error', message: 'An unexpected error occurred generating the proposal.' });
      res.end();
    } catch {
      res.end();
    }
  }
};

// ── US-066: Apply proposal as a GitHub draft PR ─────────────────────────────

function buildBranchSlug(issueType, filePath) {
  const base = `${issueType || 'refactor'}-${path.basename(filePath || 'file')}`;
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'refactor';
}

function mapGithubError(err) {
  const status = err?.status || err?.response?.status;
  if (status === 401) return { http: 401, message: 'Your GitHub token has expired. Reconnect GitHub from Settings.' };
  if (status === 403) return { http: 403, message: "You don't have write access to this repository." };
  if (status === 404) return { http: 404, message: 'The repository or one of the files in this proposal no longer exists on GitHub.' };
  if (status === 422) return { http: 422, message: 'GitHub rejected the changes — likely a path/encoding issue.' };
  if (status === 429 || (typeof status === 'number' && status >= 500 && status < 600)) {
    return { http: 502, message: 'GitHub is temporarily unavailable. Try again in a minute.' };
  }
  return { http: 500, message: 'Failed to open the pull request.' };
}

function buildPrBody({ rationale, risks, repoId, issueId, proposalId, issueType }) {
  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  const issueLink = frontendUrl
    ? `${frontendUrl}/repos/${repoId}/issues?issue=${issueId}&proposal=${proposalId}`
    : `/repos/${repoId}/issues?issue=${issueId}&proposal=${proposalId}`;

  const sections = [];
  if (rationale) sections.push(`## Why\n${rationale}`);
  if (risks && risks.length) {
    sections.push(`## Risks\n${risks.map((r) => `- ${r}`).join('\n')}`);
  }
  sections.push(`## Source\nOpened from a [CodeLens proposal](${issueLink}) for issue type \`${issueType || 'unknown'}\`.`);
  return sections.join('\n\n');
}

async function findExistingOpenPr(octokit, owner, repo, branchName) {
  try {
    const { data } = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${branchName}`,
      state: 'open',
      per_page: 1,
    });
    return data && data[0] ? data[0] : null;
  } catch {
    return null;
  }
}

const applyProposalAsPr = async (req, res) => {
  const { repoId, proposalId } = req.params;

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  // Load the proposal joined to its issue so we know the issue type / first file.
  const { data: proposal, error: propErr } = await supabaseAdmin
    .from('issue_proposals')
    .select('id, issue_id, user_id, status, proposal_json, branch_name, pr_url, analysis_issues!inner(id, type, repo_id, file_paths)')
    .eq('id', proposalId)
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (propErr) {
    console.error('[proposals.apply] Failed to load proposal:', propErr);
    return res.status(500).json({ error: 'Failed to load proposal' });
  }
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
  if (proposal.analysis_issues.repo_id !== repoId) {
    return res.status(404).json({ error: 'Proposal not found' });
  }
  if (proposal.status === 'discarded' || proposal.status === 'stale') {
    return res.status(409).json({ error: `Cannot apply a ${proposal.status} proposal — regenerate it first.` });
  }

  // Idempotent short-circuit.
  if (proposal.status === 'applied' && proposal.pr_url && proposal.branch_name) {
    return res.json({ branch_name: proposal.branch_name, pr_url: proposal.pr_url, reused: true });
  }

  const payload = proposal.proposal_json || {};
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  if (changes.length === 0) {
    return res.status(422).json({ error: 'Proposal has no changes to apply.' });
  }
  for (const change of changes) {
    if ((change.action === 'create' || change.action === 'modify') && !String(change.full_content || '').trim()) {
      return res.status(422).json({ error: 'This proposal is missing file contents; please regenerate it.' });
    }
  }

  const { data: repoRow, error: repoErr } = await supabaseAdmin
    .from('repositories')
    .select('id, full_name, default_branch, source')
    .eq('id', repoId)
    .single();
  if (repoErr || !repoRow) return res.status(404).json({ error: 'Repository not found' });
  if (repoRow.source !== 'github' || !repoRow.full_name || !repoRow.full_name.includes('/')) {
    return res.status(400).json({ error: 'Only GitHub-connected repositories support Apply via PR.' });
  }

  const githubToken = await getGithubTokenForUser(req.user.id);
  if (!githubToken) {
    return res.status(401).json({ error: 'Your GitHub token has expired. Reconnect GitHub from Settings.' });
  }

  const [owner, repoName] = repoRow.full_name.split('/');
  const octokit = getOctokit(githubToken);
  const issue = proposal.analysis_issues;
  const primaryPath = Array.isArray(issue.file_paths) ? issue.file_paths[0] : null;
  const slug = buildBranchSlug(issue.type, primaryPath);
  const branchName = `codelens/refactor/${String(proposalId).slice(0, 8)}-${slug}`;

  try {
    // Resolve default branch — prefer the stored one, fall back to a live lookup.
    let defaultBranch = repoRow.default_branch;
    if (!defaultBranch) {
      const { data: repoMeta } = await octokit.rest.repos.get({ owner, repo: repoName });
      defaultBranch = repoMeta.default_branch;
    }

    const { data: baseRef } = await octokit.rest.git.getRef({
      owner,
      repo: repoName,
      ref: `heads/${defaultBranch}`,
    });
    const baseSha = baseRef.object.sha;

    const { data: baseCommit } = await octokit.rest.git.getCommit({
      owner,
      repo: repoName,
      commit_sha: baseSha,
    });
    const baseTreeSha = baseCommit.tree.sha;

    // Build the new tree: one blob per create/modify, null sha for delete.
    const treeEntries = [];
    for (const change of changes) {
      if (change.action === 'create' || change.action === 'modify') {
        const { data: blob } = await octokit.rest.git.createBlob({
          owner,
          repo: repoName,
          content: change.full_content,
          encoding: 'utf-8',
        });
        treeEntries.push({ path: change.file_path, mode: '100644', type: 'blob', sha: blob.sha });
      } else if (change.action === 'delete') {
        treeEntries.push({ path: change.file_path, mode: '100644', type: 'blob', sha: null });
      }
    }

    const { data: newTree } = await octokit.rest.git.createTree({
      owner,
      repo: repoName,
      base_tree: baseTreeSha,
      tree: treeEntries,
    });

    const commitMessage = (payload.summary && String(payload.summary).trim()) || `Refactor: ${slug}`;
    const { data: commit } = await octokit.rest.git.createCommit({
      owner,
      repo: repoName,
      message: commitMessage.slice(0, 4096),
      tree: newTree.sha,
      parents: [baseSha],
    });

    // Create the branch ref, or reuse an existing one (e.g. retry).
    let branchExists = false;
    try {
      await octokit.rest.git.createRef({
        owner,
        repo: repoName,
        ref: `refs/heads/${branchName}`,
        sha: commit.sha,
      });
    } catch (refErr) {
      if (refErr?.status === 422) {
        branchExists = true;
      } else {
        throw refErr;
      }
    }

    let prUrl;
    if (branchExists) {
      const existing = await findExistingOpenPr(octokit, owner, repoName, branchName);
      if (existing) {
        prUrl = existing.html_url;
      } else {
        // Our branch, our commits — fast-forward it to the new commit and open a PR.
        await octokit.rest.git.updateRef({
          owner,
          repo: repoName,
          ref: `heads/${branchName}`,
          sha: commit.sha,
          force: true,
        });
      }
    }

    if (!prUrl) {
      const title = `Refactor: ${(payload.summary || slug).trim()}`.slice(0, 72);
      const body = buildPrBody({
        rationale: payload.rationale,
        risks: payload.risks,
        repoId,
        issueId: issue.id,
        proposalId,
        issueType: issue.type,
      });
      const { data: pr } = await octokit.rest.pulls.create({
        owner,
        repo: repoName,
        draft: true,
        head: branchName,
        base: defaultBranch,
        title,
        body,
      });
      prUrl = pr.html_url;
    }

    const persistResult = await withSupabaseRetry(
      () => supabaseAdmin
        .from('issue_proposals')
        .update({ status: 'applied', branch_name: branchName, pr_url: prUrl, updated_at: new Date().toISOString() })
        .eq('id', proposalId)
        .eq('user_id', req.user.id),
      { label: 'issue_proposals.update_applied' },
    );
    if (persistResult?.error) {
      console.warn('[proposals.apply] PR opened but DB write failed:', persistResult.error.message);
    }

    return res.json({ branch_name: branchName, pr_url: prUrl, reused: false });
  } catch (err) {
    const { http, message } = mapGithubError(err);
    console.error('[proposals.apply] Failed:', err?.status, err?.message);
    return res.status(http).json({ error: message });
  }
};

// ── Lightweight summary for IssueCard badges ────────────────────────────────

const listProposalSummaries = async (req, res) => {
  const { repoId } = req.params;

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  // Newest row per issue. We fetch all of the user's proposals on issues that
  // belong to this repo (inner-join filter), then pick the latest per issue_id.
  const { data, error } = await supabaseAdmin
    .from('issue_proposals')
    .select('id, issue_id, status, pr_url, created_at, analysis_issues!inner(repo_id)')
    .eq('user_id', req.user.id)
    .eq('analysis_issues.repo_id', repoId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[proposals.summary] Failed to load summaries:', error);
    return res.status(500).json({ error: 'Failed to load proposal summaries' });
  }

  const latestPerIssue = new Map();
  for (const row of data || []) {
    if (!latestPerIssue.has(row.issue_id)) {
      latestPerIssue.set(row.issue_id, {
        id: row.id,
        issue_id: row.issue_id,
        status: row.status,
        pr_url: row.pr_url || null,
      });
    }
  }

  res.json({ proposals: [...latestPerIssue.values()] });
};

const updateProposalStatus = async (req, res) => {
  const { repoId, issueId, proposalId } = req.params;
  const { status } = req.body || {};

  if (!['discarded'].includes(status)) {
    return res.status(400).json({ error: 'Unsupported proposal status' });
  }

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const issue = await fetchAnalysisIssue(repoId, issueId);
  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  const { data, error } = await supabaseAdmin
    .from('issue_proposals')
    .update({ status })
    .eq('id', proposalId)
    .eq('issue_id', issueId)
    .eq('user_id', req.user.id)
    .select('id, status')
    .maybeSingle();

  if (error) {
    console.error('[proposals] Failed to update proposal status:', error);
    return res.status(500).json({ error: 'Failed to update proposal status' });
  }
  if (!data) return res.status(404).json({ error: 'Proposal not found' });

  res.json({ ok: true, proposal: data });
};

module.exports = {
  review,
  runSecurityAudit,
  runPrReview,
  runPrReviewBackground,
  publishPrReviewEndpoint,
  ciCheckReview,
  listPullRequests,
  listPullRequestReviews,
  getPrReviewDetail,
  listSecurityAudits,
  getSecurityAudit,
  duplicationRefactor,
  generatePrFindingProposal,
  updatePrFindingProposalStatus,
  applyPrFindingProposalAsPr,
  generateProposal,
  updateProposalStatus,
  applyProposalAsPr,
  listProposalSummaries,
  _private: {
    parseFindingsFromText,
    rerankSecurityChunks,
    securityKeywordScore,
    linkFindingsToIssues,
    estimateAuditTokens,
    buildDuplicationRefactorPrompt,
    parseProposalJson,
    normalizeProposal,
    extractStreamingSummary,
    publishPrReview,
    buildPrReviewBody,
    buildInlineReviewComment,
    choosePrReviewEvent,
    buildContextForIssue,
    fetchAnalysisIssue,
    streamClaude,
  },
};
