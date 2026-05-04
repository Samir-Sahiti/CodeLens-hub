import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let supabaseAdminMock;
let indexerMock;
let supabaseCallLog;

function createSupabaseMock(handlers) {
  const exec = async (state) => {
    const key = [
      state.table,
      state.action || 'select',
      state.mode || 'many',
    ].join('.');
    if (Array.isArray(supabaseCallLog)) supabaseCallLog.push(key);
    const handler = handlers[key] || handlers[`${state.table}.${state.action}`] || handlers[state.table];
    if (!handler) return { data: null, error: null };
    return handler(state);
  };

  class Builder {
    constructor(table) {
      this.table = table;
      this.action = 'select';
      this.mode = 'many';
      this.payload = null;
      this.filters = [];
      this.columns = '*';
      this.limitCount = null;
      this.orderBy = null;
    }

    select(columns) {
      // In supabase-js, `.insert(...).select().single()` still represents an
      // insert with a returning selection. Preserve the write action.
      if (this.action === 'select') {
        this.action = 'select';
      }
      this.columns = columns || '*';
      return this;
    }
    insert(payload) {
      this.action = 'insert';
      this.payload = payload;
      return this;
    }
    update(payload) {
      this.action = 'update';
      this.payload = payload;
      return this;
    }
    delete() {
      this.action = 'delete';
      return this;
    }
    upsert(payload) {
      this.action = 'upsert';
      this.payload = payload;
      return this;
    }
    eq(column, value) {
      this.filters.push({ op: 'eq', column, value });
      return this;
    }
    gte(column, value) {
      this.filters.push({ op: 'gte', column, value });
      return this;
    }
    in(column, value) {
      this.filters.push({ op: 'in', column, value });
      return this;
    }
    order(column, opts) {
      this.orderBy = { column, opts };
      return this;
    }
    limit(n) {
      this.limitCount = n;
      return this;
    }
    single() {
      this.mode = 'single';
      return this;
    }
    maybeSingle() {
      this.mode = 'maybeSingle';
      return this;
    }
    then(resolve, reject) {
      return exec(this).then(resolve, reject);
    }
  }

  return {
    from: (table) => new Builder(table),
    rpc: async (fnName, args) => {
      const handler = handlers[`rpc.${fnName}`];
      if (!handler) return { data: null, error: null };
      return handler({ fnName, args });
    },
  };
}

// OpenAI / Anthropic are injected via globals (see beforeEach) to avoid network.

describe('Backend API integration (mocked)', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test';
    process.env.ANTHROPIC_API_KEY = 'test';

    indexerMock = {
      startGitHubIndexing: vi.fn(),
      startLocalIndexing: vi.fn(),
    };

    supabaseCallLog = [];

    globalThis.__CODELENS_OPENAI__ = {
      embeddings: {
        create: async () => ({ data: [{ embedding: [0.01, 0.02, 0.03] }] }),
      },
    };

    globalThis.__CODELENS_ANTHROPIC__ = {
      messages: {
        create: async ({ stream }) => {
          if (!stream) return { content: [{ text: 'ok' }] };
          async function* gen() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } };
          }
          return gen();
        },
      },
    };
  });

  const wrap = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };

  it('POST /api/repos connects a GitHub repo', async () => {
    supabaseAdminMock = createSupabaseMock({
      'profiles.select.single': async () => ({ data: { github_token_secret_id: 'secret-1' }, error: null }),
      'rpc.get_github_token_secret': async () => ({ data: 'gh-token', error: null }),
      'repositories.insert.single': async () => ({ data: { id: 'repo-1', name: 'acme/repo', source: 'github', status: 'pending' }, error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;
    globalThis.__CODELENS_INDEXER__ = indexerMock;

    const repoController = (await import('../src/controllers/repoController.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/repos', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(repoController.connectRepo));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .post('/api/repos')
      .send({ name: 'acme/repo' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(indexerMock.startGitHubIndexing).toHaveBeenCalledOnce();
  });

  it('POST /api/repos/:repoId/reindex clears data and restarts indexing', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'repositories.select.single': async () => ({ data: { id: 'repo-1', source: 'github', name: 'acme/repo' }, error: null }),
      'code_chunks.delete.many': async () => ({ data: null, error: null }),
      'file_contents.delete.many': async () => ({ data: null, error: null }),
      'analysis_issues.delete.many': async () => ({ data: null, error: null }),
      'graph_edges.delete.many': async () => ({ data: null, error: null }),
      'graph_nodes.delete.many': async () => ({ data: null, error: null }),
      'dependency_manifests.delete.many': async () => ({ data: null, error: null }),
      'repositories.update.many': async () => ({ data: null, error: null }),
      'profiles.select.single': async () => ({ data: { github_token_secret_id: 'secret-1' }, error: null }),
      'rpc.get_github_token_secret': async () => ({ data: 'gh-token', error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;
    globalThis.__CODELENS_INDEXER__ = indexerMock;

    const repoController = (await import('../src/controllers/repoController.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/repos/:repoId/reindex', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(repoController.reindexRepo));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .post('/api/repos/repo-1/reindex')
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(indexerMock.startGitHubIndexing).toHaveBeenCalledOnce();
  });

  it('GET /api/repos/:repoId/analysis returns nodes/edges/issues', async () => {
    supabaseAdminMock = createSupabaseMock({
      // canAccessRepo owner path
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'repositories.select.single': async () => ({ data: { has_coverage_files: true }, error: null }),
      'graph_nodes.select.many': async () => ({ data: [{ id: 'n1', repo_id: 'repo-1', file_path: 'a.js' }], error: null }),
      'graph_edges.select.many': async () => ({ data: [{ id: 'e1', repo_id: 'repo-1', from_path: 'a.js', to_path: 'b.js' }], error: null }),
      'analysis_issues.select.many': async () => ({ data: [{ id: 'i1', repo_id: 'repo-1', type: 'dead_code', severity: 'low', file_paths: ['a.js'] }], error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;
    globalThis.__CODELENS_INDEXER__ = indexerMock;

    const repoController = (await import('../src/controllers/repoController.js')).default;
    const app = express();
    app.use(express.json());
    app.get('/api/repos/:repoId/analysis', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(repoController.getAnalysisData));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .get('/api/repos/repo-1/analysis')
      .expect(200);

    expect(res.body.nodes.length).toBe(1);
    expect(res.body.edges.length).toBe(1);
    expect(res.body.issues.length).toBe(1);
    expect(res.body.hasCoverageFiles).toBe(true);
  });

  it('GET /api/repos/:repoId/duplication returns grouped clusters', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'duplication_candidates.select.many': async () => ({
        data: [
          { id: 'p1', repo_id: 'repo-1', chunk_a_id: 'a', chunk_b_id: 'b', similarity: 0.95 },
          { id: 'p2', repo_id: 'repo-1', chunk_a_id: 'b', chunk_b_id: 'c', similarity: 0.96 },
        ],
        error: null,
      }),
      'code_chunks.select.many': async () => ({
        data: [
          { id: 'a', repo_id: 'repo-1', file_path: 'a.js', start_line: 1, end_line: 12, content: 'a\n'.repeat(12) },
          { id: 'b', repo_id: 'repo-1', file_path: 'b.js', start_line: 1, end_line: 12, content: 'b\n'.repeat(12) },
          { id: 'c', repo_id: 'repo-1', file_path: 'c.js', start_line: 1, end_line: 12, content: 'c\n'.repeat(12) },
        ],
        error: null,
      }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;

    const repoController = (await import('../src/controllers/repoController.js')).default;
    const app = express();
    app.use(express.json());
    app.get('/api/repos/:repoId/duplication', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(repoController.getDuplication));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .get('/api/repos/repo-1/duplication')
      .expect(200);

    expect(res.body.clusters).toHaveLength(1);
    expect(res.body.clusters[0].member_count).toBe(3);
    expect(res.body.clusters[0].members[0].excerpt).toBeTruthy();
  });

  it('POST /api/search/:repoId streams SSE chunks (mocked RAG + Claude)', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.single': async () => ({ data: { id: 'repo-1', status: 'ready' }, error: null }),
      'rpc.match_code_chunks': async () => ({
        data: [{
          file_path: 'a.js',
          start_line: 1,
          end_line: 2,
          content: 'console.log("hi")',
          distance: 0.2,
        }],
        error: null,
      }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;
    globalThis.__CODELENS_INDEXER__ = indexerMock;

    const searchController = (await import('../src/controllers/searchController.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/search/:repoId', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(searchController.search));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .post('/api/search/repo-1')
      .send({ query: 'What does it do?' })
      .expect(200);

    expect(res.text).toContain('"type":"sources"');
    expect(res.text).toContain('"type":"chunk"');
    expect(res.text).toContain('"type":"done"');
  });

  it('POST /api/review/:repoId streams SSE chunks (mocked)', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1', status: 'ready' }, error: null }),
      'rpc.match_code_chunks': async () => ({
        data: [{
          file_path: 'a.js',
          start_line: 1,
          end_line: 2,
          content: 'function x() {}',
          distance: 0.2,
        }],
        error: null,
      }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;
    globalThis.__CODELENS_INDEXER__ = indexerMock;

    const reviewController = (await import('../src/controllers/reviewController.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/review/:repoId', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(reviewController.review));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .post('/api/review/repo-1')
      .send({ snippet: 'const x = 1;', mode: 'review' })
      .expect(200);

    expect(res.text).toContain('"type":"sources"');
    expect(res.text).toContain('"type":"chunk"');
    expect(res.text).toContain('"type":"done"');
  });

  it('POST /api/review/:repoId/duplication-refactor streams Claude output and records usage', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1', status: 'ready' }, error: null }),
      'api_usage.insert.many': async () => ({ data: null, error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;

    let anthropicArgs = null;
    globalThis.__CODELENS_ANTHROPIC__ = {
      messages: {
        create: async (args) => {
          anthropicArgs = args;
          async function* gen() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Extract shared utility.' } };
            yield { type: 'message_delta', usage: { output_tokens: 7 } };
          }
          return gen();
        },
      },
    };

    const reviewController = (await import('../src/controllers/reviewController.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/review/:repoId/duplication-refactor', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(reviewController.duplicationRefactor));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .post('/api/review/repo-1/duplication-refactor')
      .send({
        cluster: {
          member_count: 2,
          total_lines: 24,
          similarity_min: 0.95,
          similarity_max: 0.96,
          members: [
            { file_path: 'a.js', start_line: 1, end_line: 12, content: 'function a() {}' },
            { file_path: 'b.js', start_line: 1, end_line: 12, content: 'function b() {}' },
          ],
        },
      })
      .expect(200);

    expect(anthropicArgs.system).toContain('remove duplicated code');
    expect(anthropicArgs.messages[0].content).toContain('a.js');
    expect(res.text).toContain('Extract shared utility.');
    expect(res.text).toContain('"type":"done"');
    expect(supabaseCallLog).toContain('api_usage.insert.many');
  });

  it('POST /api/review/:repoId security_audit streams findings and uses security retrieval', async () => {
    let anthropicArgs = null;
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1', status: 'ready' }, error: null }),
      'analysis_issues.select.many': async () => ({
        data: [{ id: 'issue-1', type: 'insecure_pattern', severity: 'high', description: 'exec use', file_paths: ['src/auth.js'] }],
        error: null,
      }),
      'rpc.match_code_chunks': async () => ({
        data: [
          { file_path: 'src/plain.js', start_line: 1, end_line: 2, content: 'function plain() {}', distance: 0.1 },
          { file_path: 'src/auth.js', start_line: 5, end_line: 6, content: 'const token = auth(req); exec(token);', distance: 0.3 },
        ],
        error: null,
      }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;

    globalThis.__CODELENS_ANTHROPIC__ = {
      messages: {
        create: async (args) => {
          anthropicArgs = args;
          async function* gen() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"severity":"high","category":"injection","line_reference":"src/auth.js:6","explanation":"exec uses token input","suggested_fix":"Avoid shell execution","confidence":"high"}' } };
          }
          return gen();
        },
      },
    };

    const reviewController = (await import('../src/controllers/reviewController.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/review/:repoId', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(reviewController.review));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .post('/api/review/repo-1')
      .send({ snippet: 'exec(req.body.cmd)', mode: 'security_audit', filePath: 'src/auth.js' })
      .expect(200);

    expect(anthropicArgs.system).toContain('injection vulnerabilities');
    expect(anthropicArgs.system).toContain('confidence');
    expect(res.text.indexOf('src/auth.js')).toBeLessThan(res.text.indexOf('src/plain.js'));
    expect(res.text).toContain('"type":"finding"');
    expect(res.text).toContain('"matching_analysis_issues"');
  });

  it('POST /api/review/:repoId/security-audit persists partial report when source is skipped', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'api_usage.select.many': async () => ({ data: [], error: null }),
      'analysis_issues.select.many': async () => ({ data: [], error: null }),
      'rpc.get_security_audit_targets': async () => ({
        data: [
          { id: 'n1', file_path: 'missing.js', incoming_count: null, complexity_score: null, audit_score: 0 },
        ],
        error: null,
      }),
      'file_contents.select.maybeSingle': async () => ({ data: null, error: null }),
      'code_chunks.select.many': async () => ({ data: [], error: null }),
      'security_audits.insert.single': async (state) => ({ data: { id: 'audit-1', ...state.payload }, error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;

    const reviewController = (await import('../src/controllers/reviewController.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/review/:repoId/security-audit', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(reviewController.runSecurityAudit));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .post('/api/review/repo-1/security-audit')
      .expect(200);

    expect(res.text).toContain('"status":"skipped"');
    expect(res.text).toContain('"skipped_count":1');
    expect(res.text).toContain('"type":"done"');
  });

  it('security finding parsing rejects incomplete objects and links issues by category and line proximity', async () => {
    const reviewController = (await import('../src/controllers/reviewController.js')).default;
    const { parseFindingsFromText, linkFindingsToIssues } = reviewController._private;

    const findings = parseFindingsFromText([
      '{"severity":"high","category":"injection","line_reference":"src/a.js:12","explanation":"exec receives input","suggested_fix":"Use a safe API","confidence":"high"}',
      '{"severity":"high","category":"injection"}',
    ].join('\n'), { file_path: 'src/a.js' });

    expect(findings).toHaveLength(1);

    const linked = linkFindingsToIssues(findings, [
      { id: 'near', type: 'insecure_pattern', severity: 'high', description: 'Rule ID: js_exec. Line 14 uses exec.', file_paths: ['src/a.js'] },
      { id: 'same-file-weak', type: 'dead_code', severity: 'low', description: 'Unused file.', file_paths: ['src/a.js'] },
      { id: 'other-file', type: 'insecure_pattern', severity: 'high', description: 'Line 12 uses exec.', file_paths: ['src/b.js'] },
    ]);

    expect(linked[0].matching_analysis_issues.map((issue) => issue.id)).toEqual(['near']);
    expect(linked[0].matching_analysis_issues[0].match_reason.category_match).toBe(true);
    expect(linked[0].matching_analysis_issues[0].match_reason.line_proximity).toBe(2);
  });
});
