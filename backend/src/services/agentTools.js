/**
 * Agent tool surface (US-068).
 *
 * Exposes a registry of read-only (plus one write) tools that wrap CodeLens's
 * deterministic analysis — graph, issues, attack paths, RAG retrieval, file
 * reads, and the existing refactor-proposal pipeline (US-064).
 *
 * Two exports:
 *   - `tools`         — Anthropic-format tool schema array (pass into messages.create).
 *   - `toolHandlers`  — { [tool_name]: async (input, ctx) => result }.
 *
 * The handler contract (load-bearing, do not change without updating the loop):
 *   - Every handler calls canAccessRepo first. Per-call gating because crafted
 *     prompts can swap repo ids between turns.
 *   - Every handler is wrapped in try/catch. Failures return
 *     { is_error: true, message } so the loop can fold them into a tool_result
 *     block without crashing.
 *   - Collection-returning tools cap at 50 rows and stamp
 *     { truncated: true, total: N } when the underlying query had more.
 *
 * The model picks tools by description, not name — descriptions are the
 * product surface. Edit them with care.
 */

const { supabaseAdmin } = require('../db/supabase');
const { canAccessRepo } = require('../lib/repoAccess');
const graphService = require('./graphService');
const { readFile } = require('./fileService');
const { embedQuery, retrieveChunks } = require('../ai/ragService');
const repoController = require('../controllers/repoController');
const reviewController = require('../controllers/reviewController');
const { buildRiskContext, computeRiskComponents } = require('./riskScoring');

const COLLECTION_LIMIT = 50;

// ─── tool schema definitions (Anthropic format) ────────────────────────────

const tools = [
  {
    name: 'get_graph_overview',
    description: 'Returns high-level statistics of the repository\'s dependency graph: total node count (`nodeCount`), total edge count (`edgeCount`), the top 10 hub files by incoming imports (`topHubs`), the top 10 files by outgoing imports (`topSinks`), and the count of strongly-connected components containing a cycle (`cyclicComponentCount` — a 10-file cycle is one component, not 10 cycles). Use this first to orient yourself in an unfamiliar repo before drilling into specific files.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_issues',
    description: 'Lists architectural and security issues detected by CodeLens. Filterable by type, severity, and file path. Issue types: circular_dependency, god_file, dead_code, high_coupling, hardcoded_secret, insecure_pattern, vulnerable_dependency, missing_auth, refactoring_candidate. Use this when the user asks about problems, smells, vulnerabilities, or "what\'s wrong" with a repo.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter to a single issue type (e.g. "god_file").' },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Filter by severity.' },
        file: { type: 'string', description: 'Filter to issues that mention this file path.' },
        sort_by: { type: 'string', enum: ['risk', 'severity', 'recent'], description: 'Sort order. Defaults to risk.' },
      },
    },
  },
  {
    name: 'get_file_metrics',
    description: 'Returns metrics for a single file: language, line count, cyclomatic complexity, incoming dependency count, outgoing dependency count, attack-surface classification (source / sink / both / null), and whether the file is a test. Use this to assess the size and centrality of a specific file.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repo-relative file path.' } },
      required: ['path'],
    },
  },
  {
    name: 'get_blast_radius',
    description: 'Returns the set of files that would be affected by changing a given file. Two DISJOINT arrays: `direct` lists files that import the target (one hop), `transitive` lists files reached at depth ≥ 2. Total impact = `direct.length + transitive.length`. Use this to assess the impact of a refactor, rename, or deletion before recommending it. Optionally bound by depth.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo-relative file path.' },
        depth: { type: 'integer', description: 'Maximum BFS depth. Omit for unbounded.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_dependents',
    description: 'Returns the files that directly import the given file (one hop only). Faster than get_blast_radius when you only need immediate consumers.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repo-relative file path.' } },
      required: ['path'],
    },
  },
  {
    name: 'get_imports',
    description: 'Returns the files that the given file imports (one hop only). Use this to understand what a file depends on.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repo-relative file path.' } },
      required: ['path'],
    },
  },
  {
    name: 'find_paths',
    description: 'Returns dependency paths from one file to another through the import graph. Use this to understand how a change in one part of the repo can reach another part. Result is up to max_paths paths, each path being an ordered list of file paths.',
    input_schema: {
      type: 'object',
      properties: {
        from_path: { type: 'string' },
        to_path: { type: 'string' },
        max_paths: { type: 'integer', description: 'Default 10.' },
      },
      required: ['from_path', 'to_path'],
    },
  },
  {
    name: 'get_attack_paths',
    description: 'Returns reachability paths from attack-surface sources (HTTP routes, CLI entry points, stdin readers) to dangerous sinks (SQL, shell, fs writes, deserialisation, dynamic HTTP) through the import graph. Use this for security questions like "where can untrusted input reach a sink?". Optionally filter to a single source or single sink.',
    input_schema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Restrict to paths starting from this file.' },
        sink: { type: 'string', description: 'Restrict to paths ending at this file.' },
        max_paths: { type: 'integer', description: 'Default 20.' },
      },
    },
  },
  {
    name: 'search_code',
    description: 'Semantic code search using vector embeddings. Returns the top-k most relevant code chunks (raw — not synthesised) for a natural-language query. Use this to find code by intent ("where do we validate JWTs?") when you do not know the file path. Pair with read_file to inspect a match in full.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        top_k: { type: 'integer', description: 'Default 8. Max 20.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_file',
    description: 'Returns the full text of an indexed file, optionally clipped to a line range. Use this when you need to read code precisely after locating it with search_code or list_issues.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        start_line: { type: 'integer' },
        end_line: { type: 'integer' },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_vulns',
    description: 'Returns the repository\'s third-party dependencies with known CVEs from OSV.dev. Optionally filter by severity. Use this for any "what dependencies are vulnerable" question.',
    input_schema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      },
    },
  },
  {
    name: 'propose_fix',
    description: 'Generates a structured refactor proposal for an analysis_issues row and persists it. The proposal includes a summary, rationale, per-file unified diffs and full file contents, and risks. The user can then open the full proposal panel and apply it as a draft PR. Use this only when the user explicitly asks to fix, refactor, or propose a change for a specific issue. This is the only write-side tool and consumes meaningful tokens.',
    input_schema: {
      type: 'object',
      properties: { issue_id: { type: 'string', description: 'UUID of the analysis_issues row.' } },
      required: ['issue_id'],
    },
  },
];

// ─── handler implementations ──────────────────────────────────────────────

function asError(message) {
  return { is_error: true, message };
}

function withTruncation(items, limit = COLLECTION_LIMIT) {
  if (!Array.isArray(items)) return items;
  if (items.length <= limit) return { items };
  return { items: items.slice(0, limit), truncated: true, total: items.length };
}

async function gate(ctx) {
  const allowed = await canAccessRepo(ctx.repoId, ctx.userId);
  if (!allowed) throw new Error('Repository not found or unauthorized');
}

const toolHandlers = {
  async get_graph_overview(_input, ctx) {
    try {
      await gate(ctx);
      return await graphService.getGraphOverview(ctx.repoId);
    } catch (err) {
      return asError(err.message);
    }
  },

  async list_issues(input = {}, ctx) {
    try {
      await gate(ctx);
      let q = supabaseAdmin
        .from('analysis_issues')
        .select('id, type, severity, file_paths, description, risk_score, created_at', { count: 'exact' })
        .eq('repo_id', ctx.repoId);
      if (input.type) q = q.eq('type', input.type);
      if (input.severity) q = q.eq('severity', input.severity);
      if (input.file) q = q.contains('file_paths', [input.file]);
      const sortBy = input.sort_by || 'risk';
      if (sortBy === 'risk') {
        q = q.order('risk_score', { ascending: false, nullsFirst: false });
      } else if (sortBy === 'recent') {
        q = q.order('created_at', { ascending: false });
      }
      q = q.range(0, COLLECTION_LIMIT - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      // Sort high → medium → low in JS — Supabase string ordering would put
      // 'medium' before 'low' which is actively misleading.
      const SEV_RANK = { high: 3, critical: 4, medium: 2, low: 1 };
      const riskCtx = await buildRiskContext(ctx.repoId);
      const rowsWithComponents = (data || []).map((issue) => {
        const components = computeRiskComponents(issue, riskCtx);
        return {
          ...issue,
          risk_score: issue.risk_score == null ? components.risk_score : issue.risk_score,
          severity_weight: components.severity_weight,
          blast_factor: components.blast_factor,
          churn_factor: components.churn_factor,
        };
      });
      const rows = rowsWithComponents.slice().sort((a, b) => {
        if (sortBy === 'recent') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        if (sortBy === 'severity') return (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0);
        return (b.risk_score ?? -Infinity) - (a.risk_score ?? -Infinity);
      });
      if (typeof count === 'number' && count > rows.length) {
        return { items: rows, truncated: true, total: count };
      }
      return { items: rows };
    } catch (err) {
      return asError(err.message);
    }
  },

  async get_file_metrics(input, ctx) {
    try {
      await gate(ctx);
      const row = await graphService.getFileMetrics(ctx.repoId, input?.path);
      if (!row) return asError(`No metrics for ${input?.path}`);
      return row;
    } catch (err) {
      return asError(err.message);
    }
  },

  async get_blast_radius(input, ctx) {
    try {
      await gate(ctx);
      const { direct, transitive } = await graphService.getBlastRadius(ctx.repoId, input?.path, input?.depth);
      return {
        direct: direct.slice(0, COLLECTION_LIMIT),
        transitive: transitive.slice(0, COLLECTION_LIMIT),
        truncated: direct.length > COLLECTION_LIMIT || transitive.length > COLLECTION_LIMIT,
        total_direct: direct.length,
        total_transitive: transitive.length,
      };
    } catch (err) {
      return asError(err.message);
    }
  },

  async get_dependents(input, ctx) {
    try {
      await gate(ctx);
      const items = await graphService.getDependents(ctx.repoId, input?.path);
      return withTruncation(items);
    } catch (err) {
      return asError(err.message);
    }
  },

  async get_imports(input, ctx) {
    try {
      await gate(ctx);
      const items = await graphService.getImports(ctx.repoId, input?.path);
      return withTruncation(items);
    } catch (err) {
      return asError(err.message);
    }
  },

  async find_paths(input, ctx) {
    try {
      await gate(ctx);
      const cap = Math.min(input?.max_paths || 10, COLLECTION_LIMIT);
      const paths = await graphService.findPaths(ctx.repoId, input?.from_path, input?.to_path, cap);
      return { paths };
    } catch (err) {
      return asError(err.message);
    }
  },

  async get_attack_paths(input = {}, ctx) {
    try {
      await gate(ctx);
      const cap = Math.min(input.max_paths || 20, COLLECTION_LIMIT);
      const { paths, truncated } = await graphService.getAttackPaths(ctx.repoId, {
        source: input.source,
        sink: input.sink,
        maxPaths: cap,
      });
      return { paths, truncated };
    } catch (err) {
      return asError(err.message);
    }
  },

  async search_code(input, ctx) {
    try {
      await gate(ctx);
      const topK = Math.min(input?.top_k || 8, 20);
      const { embedding } = await embedQuery(input?.query);
      const chunks = await retrieveChunks(ctx.repoId, embedding, topK);
      return { chunks };
    } catch (err) {
      return asError(err.message);
    }
  },

  async read_file(input, ctx) {
    try {
      await gate(ctx);
      const result = await readFile(ctx.repoId, input?.path, {
        startLine: input?.start_line,
        endLine: input?.end_line,
      });
      if (!result) return asError(`No indexed content for ${input?.path}`);
      return result;
    } catch (err) {
      return asError(err.message);
    }
  },

  async get_vulns(input = {}, ctx) {
    try {
      await gate(ctx);
      const deps = await repoController.getStoredDependenciesWithIssues(ctx.repoId);
      let filtered = deps;
      if (input.severity) {
        const wanted = String(input.severity).toLowerCase();
        filtered = deps
          .map((d) => ({
            ...d,
            vulns_json: (d.vulns_json || []).filter((v) => String(v.severity || '').toLowerCase() === wanted),
          }))
          .filter((d) => (d.vulns_json || []).length > 0);
      } else {
        filtered = deps.filter((d) => (d.vuln_count || 0) > 0);
      }
      return withTruncation(filtered);
    } catch (err) {
      return asError(err.message);
    }
  },

  async propose_fix(input, ctx) {
    try {
      await gate(ctx);
      const issueId = input?.issue_id;
      if (!issueId) return asError('issue_id is required');
      const {
        fetchAnalysisIssue,
        buildContextForIssue,
        streamClaude,
        parseProposalJson,
        normalizeProposal,
      } = reviewController._private;

      const issue = await fetchAnalysisIssue(ctx.repoId, issueId);
      if (!issue) return asError(`Issue ${issueId} not found`);

      const { system, user } = await buildContextForIssue(issue, ctx.repoId);
      // No SSE send fn — the agent loop emits its own tool_result event; req=null
      // so streamClaude's abort binding is a no-op when called outside HTTP.
      const { text, inputTokens, outputTokens } = await streamClaude({
        system,
        user,
        userId: ctx.userId,
        endpoint: 'agent_propose_fix',
        maxTokens: 4000,
        req: null,
      });

      const parsed = normalizeProposal(parseProposalJson(text));
      if (!parsed) return asError('Model returned an unparseable proposal');

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('issue_proposals')
        .insert({
          issue_id: issueId,
          user_id: ctx.userId,
          status: 'pending',
          proposal_json: parsed,
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
        })
        .select('id')
        .single();

      if (insErr) return asError(`Could not persist proposal: ${insErr.message}`);

      return {
        proposal_id: inserted.id,
        issue_id: issueId,
        summary: parsed.summary,
        change_count: (parsed.changes || []).length,
        risk_count: (parsed.risks || []).length,
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
      };
    } catch (err) {
      return asError(err.message);
    }
  },
};

/** Tools that can run concurrently in Promise.all. propose_fix is excluded. */
const READ_ONLY_TOOLS = new Set([
  'get_graph_overview',
  'list_issues',
  'get_file_metrics',
  'get_blast_radius',
  'get_dependents',
  'get_imports',
  'find_paths',
  'get_attack_paths',
  'search_code',
  'read_file',
  'get_vulns',
]);

function isReadOnlyTool(name) {
  return READ_ONLY_TOOLS.has(name);
}

module.exports = { tools, toolHandlers, isReadOnlyTool };
