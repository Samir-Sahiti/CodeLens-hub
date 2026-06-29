import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

const octokitMockState = {
  pullsGetResult: { data: { head: { sha: 'headsha123' }, base: { sha: 'basesha123' } } },
  listFilesResult: { data: [{ filename: 'src/index.js', additions: 2, patch: '+const a = 1\n' }] },
  getContentResult: { data: { content: Buffer.from('const a = 1;\n').toString('base64'), encoding: 'base64' } },
};

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
    upsert(payload, options) {
      this.action = 'upsert';
      this.payload = payload;
      this.options = options;
      return this;
    }
    onConflict() {
      return this;
    }
    merge(payload) {
      this.payload = payload;
      return this;
    }
    eq(column, value) {
      this.filters.push({ op: 'eq', column, value });
      return this;
    }
    neq(column, value) {
      this.filters.push({ op: 'neq', column, value });
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
    contains(column, value) {
      this.filters.push({ op: 'contains', column, value });
      return this;
    }
    overlaps(column, value) {
      this.filters.push({ op: 'overlaps', column, value });
      return this;
    }
    is(column, value) {
      this.filters.push({ op: 'is', column, value });
      return this;
    }
    lt(column, value) {
      this.filters.push({ op: 'lt', column, value });
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
    range(from, to) {
      this.rangeFrom = from;
      this.rangeTo = to;
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
    auth: {
      admin: {
        getUserById: async (userId) => {
          const handler = handlers['auth.admin.getUserById'];
          if (!handler) return { data: { user: { id: userId, email: `${userId}@example.com`, user_metadata: {} } }, error: null };
          return handler(userId);
        },
      },
    },
    rpc: async (fnName, args) => {
      const handler = handlers[`rpc.${fnName}`];
      if (!handler && fnName === 'can_access_repo') return { data: true, error: null };
      if (!handler) return { data: null, error: null };
      return handler({ fnName, args });
    },
  };
}

// OpenAI is injected via globals (see beforeEach) to avoid network calls.

describe('Backend API integration (mocked)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    process.env.OPENAI_API_KEY = 'test';

    indexerMock = {
      startGitHubIndexing: vi.fn(),
      startLocalIndexing: vi.fn(),
    };

    supabaseCallLog = [];
    globalThis.__CODELENS_NOTIFICATION_EVENTS__ = [];
    globalThis.__CODELENS_GITHUB_TOKEN__ = null;
    globalThis.__CODELENS_OCTOKIT__ = null;

    globalThis.__CODELENS_OPENAI__ = {
      embeddings: {
        create: async () => ({ data: [{ embedding: [0.01, 0.02, 0.03] }], usage: { total_tokens: 3 } }),
      },
      chat: {
        completions: {
          create: async ({ stream }) => {
            // Non-streaming (e.g. agent title generation, tour steps).
            if (!stream) {
              return { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
            }
            // Streaming: OpenAI-shaped chunks + a final usage chunk
            // (stream_options.include_usage emits usage with empty choices).
            async function* gen() {
              yield { choices: [{ delta: { content: 'Hello' } }] };
              yield { choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] };
              yield { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } };
            }
            return gen();
          },
        },
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('GET /api/repos/:repoId/tours returns visible tours with ordered steps and creator metadata', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'team_members.select.many': async () => ({ data: [], error: null }),
      'tours.select.many': async () => ({
        data: [
          {
            id: 'tour-1',
            repo_id: 'repo-1',
            created_by: 'user-1',
            title: 'Start Here',
            description: 'Intro',
            original_query: null,
            is_auto_generated: true,
            is_team_shared: false,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
          },
          {
            id: 'tour-2',
            repo_id: 'repo-1',
            created_by: 'other-user',
            title: 'Shared',
            description: null,
            original_query: 'How does auth work?',
            is_auto_generated: false,
            is_team_shared: true,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
          },
        ],
        error: null,
      }),
      'tour_steps.select.many': async () => ({
        data: [
          { id: 's2', tour_id: 'tour-1', step_order: 2, file_path: 'b.js', start_line: 2, end_line: 3, explanation: 'B' },
          { id: 's1', tour_id: 'tour-1', step_order: 1, file_path: 'a.js', start_line: 1, end_line: 2, explanation: 'A' },
        ].sort((a, b) => a.step_order - b.step_order),
        error: null,
      }),
      'auth.admin.getUserById': async (userId) => ({
        data: {
          user: {
            id: userId,
            email: 'dev@example.com',
            user_metadata: { name: 'Dev User', avatar_url: 'https://example.com/avatar.png' },
          },
        },
        error: null,
      }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const toursController = (await import('../src/controllers/toursController.js')).default;
    const app = express();
    app.use(express.json());
    app.get('/api/repos/:repoId/tours', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(toursController.listTours));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .get('/api/repos/repo-1/tours')
      .expect(200);

    expect(res.body.tours).toHaveLength(1);
    expect(res.body.tours[0].title).toBe('Start Here');
    expect(res.body.tours[0].step_count).toBe(2);
    expect(res.body.tours[0].steps.map((step) => step.step_order)).toEqual([1, 2]);
    expect(res.body.tours[0].creator.name).toBe('Dev User');
    expect(res.body.tours[0].creator.avatar_url).toBe('https://example.com/avatar.png');
  });

  it('DELETE /api/repos/:repoId/tours/:tourId deletes creator-owned tours only', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'team_members.select.many': async () => ({ data: [], error: null }),
      'tours.select.maybeSingle': async () => ({ data: { id: 'tour-1', created_by: 'user-1' }, error: null }),
      'tours.delete.many': async () => ({ data: null, error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const toursController = (await import('../src/controllers/toursController.js')).default;
    const app = express();
    app.use(express.json());
    app.delete('/api/repos/:repoId/tours/:tourId', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(toursController.deleteTour));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .delete('/api/repos/repo-1/tours/tour-1')
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(supabaseCallLog).toContain('tours.delete.many');
  });

  it('PATCH /api/repos/:repoId/tours/:tourId updates tour and renumbers steps via RPC', async () => {
    const rpcCalls = [];
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'team_members.select.many': async () => ({ data: [], error: null }),
      'tours.select.maybeSingle': async () => ({ data: { id: 'tour-1', created_by: 'user-1', is_team_shared: false }, error: null }),
      'graph_nodes.select.many': async () => ({
        data: [{ file_path: 'a.js' }, { file_path: 'b.js' }],
        error: null,
      }),
      'tours.select.single': async () => ({
        data: {
          id: 'tour-1', repo_id: 'repo-1', created_by: 'user-1', title: 'Renamed', description: null,
          original_query: null, is_auto_generated: false, is_team_shared: false, forked_from: null,
          created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-02T00:00:00Z',
        },
        error: null,
      }),
      'tour_steps.select.many': async () => ({
        data: [
          { id: 's1', tour_id: 'tour-1', step_order: 1, file_path: 'a.js', start_line: 1, end_line: 2, explanation: 'step one description' },
          { id: 's2', tour_id: 'tour-1', step_order: 2, file_path: 'b.js', start_line: 3, end_line: 4, explanation: 'step two description' },
        ],
        error: null,
      }),
      'rpc.update_tour_with_steps': async ({ args }) => {
        rpcCalls.push(args);
        return { data: null, error: null };
      },
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const toursController = (await import('../src/controllers/toursController.js')).default;
    const app = express();
    app.use(express.json());
    app.patch('/api/repos/:repoId/tours/:tourId', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(toursController.updateTour));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .patch('/api/repos/repo-1/tours/tour-1')
      .send({
        title: 'Renamed',
        description: null,
        is_team_shared: false,
        steps: [
          { order: 1, file_path: 'b.js', start_line: 3, end_line: 4, explanation: 'step two description' },
          { order: 0, file_path: 'a.js', start_line: 1, end_line: 2, explanation: 'step one description' },
        ],
      })
      .expect(200);

    expect(res.body.tour.title).toBe('Renamed');
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].p_title).toBe('Renamed');
    // Ordering by `order` ASC happens server-side via row_number() so payload order is preserved as-is
    expect(rpcCalls[0].p_steps[0].file_path).toBe('b.js');
    expect(rpcCalls[0].p_steps[1].file_path).toBe('a.js');
  });

  it('PATCH /api/repos/:repoId/tours/:tourId rejects non-creator with 403', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'team_members.select.many': async () => ({ data: [], error: null }),
      'tours.select.maybeSingle': async () => ({ data: { id: 'tour-1', created_by: 'other-user', is_team_shared: false }, error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const toursController = (await import('../src/controllers/toursController.js')).default;
    const app = express();
    app.use(express.json());
    app.patch('/api/repos/:repoId/tours/:tourId', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(toursController.updateTour));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    await request(app)
      .patch('/api/repos/repo-1/tours/tour-1')
      .send({
        steps: [
          { order: 0, file_path: 'a.js', start_line: 1, end_line: 2, explanation: 'long enough explanation' },
          { order: 1, file_path: 'b.js', start_line: 1, end_line: 2, explanation: 'long enough explanation' },
        ],
      })
      .expect(403);
  });

  it('PATCH /api/repos/:repoId/tours/:tourId rejects unknown file paths with 400', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'team_members.select.many': async () => ({ data: [], error: null }),
      'tours.select.maybeSingle': async () => ({ data: { id: 'tour-1', created_by: 'user-1', is_team_shared: false }, error: null }),
      'graph_nodes.select.many': async () => ({ data: [{ file_path: 'a.js' }], error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const toursController = (await import('../src/controllers/toursController.js')).default;
    const app = express();
    app.use(express.json());
    app.patch('/api/repos/:repoId/tours/:tourId', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(toursController.updateTour));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .patch('/api/repos/repo-1/tours/tour-1')
      .send({
        steps: [
          { order: 0, file_path: 'a.js',       start_line: 1, end_line: 2, explanation: 'long enough explanation' },
          { order: 1, file_path: 'unknown.js', start_line: 1, end_line: 2, explanation: 'long enough explanation' },
        ],
      })
      .expect(400);

    expect(res.body.error).toMatch(/unknown file path/i);
  });

  it('POST /api/repos/:repoId/tours/:tourId/fork deep-copies the tour for the caller', async () => {
    const rpcCalls = [];
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'team_members.select.many': async () => ({ data: [], error: null }),
      'tours.select.maybeSingle': async () => ({
        data: { id: 'tour-1', created_by: 'user-1', is_team_shared: false, repo_id: 'repo-1' },
        error: null,
      }),
      'tours.select.single': async () => ({
        data: {
          id: 'new-tour-id', repo_id: 'repo-1', created_by: 'user-1',
          title: 'Copy of Original', description: null, original_query: null,
          is_auto_generated: false, is_team_shared: false, forked_from: 'tour-1',
          created_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z',
        },
        error: null,
      }),
      'tour_steps.select.many': async () => ({
        data: [{ id: 'sf', tour_id: 'new-tour-id', step_order: 1, file_path: 'a.js', start_line: 1, end_line: 2, explanation: 'step' }],
        error: null,
      }),
      'rpc.fork_tour': async ({ args }) => {
        rpcCalls.push(args);
        return { data: 'new-tour-id', error: null };
      },
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const toursController = (await import('../src/controllers/toursController.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/repos/:repoId/tours/:tourId/fork', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(toursController.forkTour));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .post('/api/repos/repo-1/tours/tour-1/fork')
      .expect(201);

    expect(res.body.tour.id).toBe('new-tour-id');
    expect(res.body.tour.forked_from).toBe('tour-1');
    expect(rpcCalls[0]).toEqual({ p_tour_id: 'tour-1', p_user_id: 'user-1' });
  });

  it('POST /api/repos/:repoId/tours/:tourId/fork rejects non-team-shared tours from non-creators', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'team_members.select.many': async () => ({ data: [{ team_id: 't1' }], error: null }),
      'team_repositories.select.maybeSingle': async () => ({ data: { repo_id: 'repo-1' }, error: null }),
      'tours.select.maybeSingle': async () => ({
        data: { id: 'tour-1', created_by: 'other-user', is_team_shared: false, repo_id: 'repo-1' },
        error: null,
      }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const toursController = (await import('../src/controllers/toursController.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/repos/:repoId/tours/:tourId/fork', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(toursController.forkTour));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    await request(app)
      .post('/api/repos/repo-1/tours/tour-1/fork')
      .expect(403);
  });

  it('GET /api/repos/:repoId/tours/:tourId/share-impact counts distinct teammates excluding creator', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'team_members.select.many': async () => ({
        data: [
          { team_id: 't1', user_id: 'user-1' }, // viewer
          { team_id: 't1', user_id: 'user-2' },
          { team_id: 't1', user_id: 'user-3' },
        ],
        error: null,
      }),
      'tours.select.maybeSingle': async () => ({
        data: { id: 'tour-1', created_by: 'user-1', is_team_shared: true },
        error: null,
      }),
      'team_repositories.select.many': async () => ({ data: [{ team_id: 't1' }], error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const toursController = (await import('../src/controllers/toursController.js')).default;
    const app = express();
    app.use(express.json());
    app.get('/api/repos/:repoId/tours/:tourId/share-impact', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(toursController.getShareImpact));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .get('/api/repos/repo-1/tours/tour-1/share-impact')
      .expect(200);

    // user-2 and user-3 (user-1 is the creator, excluded)
    expect(res.body.teammate_count).toBe(2);
  });

  it('DELETE /api/repos/:repoId/tours/:tourId rejects non-creator deletion', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'team_members.select.many': async () => ({ data: [], error: null }),
      'tours.select.maybeSingle': async () => ({ data: { id: 'tour-1', created_by: 'other-user' }, error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const toursController = (await import('../src/controllers/toursController.js')).default;
    const app = express();
    app.use(express.json());
    app.delete('/api/repos/:repoId/tours/:tourId', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(toursController.deleteTour));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    await request(app)
      .delete('/api/repos/repo-1/tours/tour-1')
      .expect(403);

    expect(supabaseCallLog).not.toContain('tours.delete.many');
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

    let openaiArgs = null;
    globalThis.__CODELENS_OPENAI__ = {
      chat: {
        completions: {
          create: async (args) => {
            openaiArgs = args;
            async function* gen() {
              yield { choices: [{ delta: { content: 'Extract shared utility.' }, finish_reason: 'stop' }] };
              yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 7 } };
            }
            return gen();
          },
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

    const sysMsg = openaiArgs.messages.find((m) => m.role === 'system');
    const userMsg = openaiArgs.messages.find((m) => m.role === 'user');
    expect(sysMsg.content).toContain('remove duplicated code');
    expect(userMsg.content).toContain('a.js');
    expect(res.text).toContain('Extract shared utility.');
    expect(res.text).toContain('"type":"done"');
    expect(supabaseCallLog).toContain('api_usage.insert.many');
  });

  it('POST /api/review/:repoId security_audit streams findings and uses security retrieval', async () => {
    let openaiArgs = null;
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

    globalThis.__CODELENS_OPENAI__ = {
      embeddings: {
        create: async () => ({ data: [{ embedding: [0.01, 0.02, 0.03] }], usage: { total_tokens: 3 } }),
      },
      chat: {
        completions: {
          create: async (args) => {
            openaiArgs = args;
            async function* gen() {
              yield { choices: [{ delta: { content: '{"severity":"high","category":"injection","line_reference":"src/auth.js:6","explanation":"exec uses token input","suggested_fix":"Avoid shell execution","confidence":"high"}' }, finish_reason: 'stop' }] };
              yield { choices: [], usage: { prompt_tokens: 8, completion_tokens: 20 } };
            }
            return gen();
          },
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

    const auditSysMsg = openaiArgs.messages.find((m) => m.role === 'system');
    expect(auditSysMsg.content).toContain('injection vulnerabilities');
    expect(auditSysMsg.content).toContain('confidence');
    expect(res.text.indexOf('src/auth.js')).toBeLessThan(res.text.indexOf('src/plain.js'));
    expect(res.text).toContain('"type":"finding"');
    expect(res.text).toContain('"matching_analysis_issues"');
  });

  it('POST /api/review/:repoId/security-audit persists partial report when source is skipped', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'api_usage.select.many': async () => ({ data: [], error: null }),
      'analysis_issues.select.many': async () => ({ data: [], error: null }),
      'graph_nodes.select.many': async () => ({
        data: [
          { id: 'n1', file_path: 'missing.js', language: 'javascript', incoming_count: null, complexity_score: null, line_count: null, node_classification: null },
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

  it('whole-repo audit targets prioritise security-relevant files over larger benign ones', async () => {
    supabaseAdminMock = createSupabaseMock({
      'graph_nodes.select.many': async () => ({
        data: [
          { id: 'big', file_path: 'big.js', language: 'js', incoming_count: 40, complexity_score: 60, line_count: 800, node_classification: null },
          { id: 'route', file_path: 'route.js', language: 'js', incoming_count: 1, complexity_score: 2, line_count: 20, node_classification: 'source' },
          { id: 'secret', file_path: 'secret.js', language: 'js', incoming_count: 0, complexity_score: 1, line_count: 10, node_classification: null },
        ],
        error: null,
      }),
      'analysis_issues.select.many': async () => ({
        data: [{ id: 'i1', type: 'hardcoded_secret', severity: 'high', file_paths: ['secret.js'] }],
        error: null,
      }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;

    const reviewController = (await import('../src/controllers/reviewController.js')).default;
    const targets = await reviewController._private.fetchAuditTargets('repo-1');
    const order = targets.map((t) => t.file_path);

    // Despite the lowest structural score, the secret-bearing file and the
    // attack-surface route outrank the large-but-benign file.
    expect(order.indexOf('secret.js')).toBeLessThan(order.indexOf('big.js'));
    expect(order.indexOf('route.js')).toBeLessThan(order.indexOf('big.js'));

    const secret = targets.find((t) => t.file_path === 'secret.js');
    expect(secret.security_signal).toBe('security_issue');
    // audit_score stays the plain structural score, not polluted by tier offsets.
    expect(secret.audit_score).toBe(1);
    expect(targets.find((t) => t.file_path === 'route.js').security_signal).toBe('attack_surface');
    expect(targets.some((t) => '_rank' in t)).toBe(false);
  });

  it('whole-repo audit excludes "secure" sentinels from findings and counts', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1' }, error: null }),
      'api_usage.select.many': async () => ({ data: [], error: null }),
      'analysis_issues.select.many': async () => ({ data: [], error: null }),
      'graph_nodes.select.many': async () => ({
        data: [{ id: 'n1', file_path: 'clean.js', language: 'js', incoming_count: 5, complexity_score: 3, line_count: 40, node_classification: null }],
        error: null,
      }),
      'file_contents.select.maybeSingle': async () => ({ data: { content: 'export const x = 1;\n' }, error: null }),
      'rpc.match_code_chunks': async () => ({ data: [], error: null }),
      'security_audits.insert.single': async (state) => ({ data: { id: 'audit-1', ...state.payload }, error: null }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;
    globalThis.__CODELENS_OPENAI__ = {
      embeddings: { create: async () => ({ data: [{ embedding: [0.01, 0.02, 0.03] }], usage: { total_tokens: 3 } }) },
      chat: {
        completions: {
          create: async () => {
            async function* gen() {
              yield { choices: [{ delta: { content: '{"severity":"low","category":"secure","line_reference":"clean.js","explanation":"no issue found","suggested_fix":"No fix needed.","confidence":"high"}' }, finish_reason: 'stop' }] };
              yield { choices: [], usage: { prompt_tokens: 5, completion_tokens: 10 } };
            }
            return gen();
          },
        },
      },
    };

    const reviewController = (await import('../src/controllers/reviewController.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/review/:repoId/security-audit', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(reviewController.runSecurityAudit));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .post('/api/review/repo-1/security-audit')
      .expect(200);

    // The clean file is audited, but its "secure" sentinel is neither emitted as
    // a finding nor counted.
    expect(res.text).toContain('"audited_count":1');
    expect(res.text).toContain('"findings_count":0');
    expect(res.text).not.toContain('"type":"finding"');
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

  it('POST /api/repos/:repoId/pulls/:number/reviews stores a PR review and streams findings', async () => {
    octokitMockState.pullsGetResult = { data: { head: { sha: 'headsha123' }, base: { sha: 'basesha123' } } };
    octokitMockState.listFilesResult = {
      data: [{
        filename: 'src/index.js',
        additions: 1,
        patch: "@@ -0,0 +1,1 @@\n+const token = 'abcdefghijklmnopqrstuvwxyz1234567890';\n",
      }],
    };
    octokitMockState.getContentResult = { data: { content: Buffer.from("const token = 'abcdefghijklmnopqrstuvwxyz1234567890';\n").toString('base64'), encoding: 'base64' } };
    globalThis.__CODELENS_OCTOKIT__ = {
      Octokit: class {
        constructor() {}
        get rest() {
          return {
            pulls: {
              get: async () => octokitMockState.pullsGetResult,
              listFiles: async () => octokitMockState.listFilesResult,
            },
            repos: {
              getContent: async () => octokitMockState.getContentResult,
            },
          };
        }
        get paginate() {
          return {
            iterator: async function* () {
              yield { data: octokitMockState.listFilesResult.data };
            },
          };
        }
      },
    };
    globalThis.__CODELENS_GITHUB_TOKEN__ = 'gh-token';

    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1', full_name: 'owner/repo' }, error: null }),
      'repositories.select.single': async () => ({ data: { full_name: 'owner/repo' }, error: null }),
      'issue_suppressions.select.many': async () => ({ data: [], error: null }),
      'analysis_issues.select.many': async () => ({ data: [], error: null }),
      'graph_edges.select.many': async () => ({ data: [], error: null }),
      'graph_nodes.select.many': async () => ({ data: [{ file_path: 'src/index.js' }], error: null }),
      'pr_reviews.upsert.maybeSingle': async (state) => ({ data: { id: 'review-1', ...state.payload, upsertOptions: state.options }, error: null }),
      'pr_reviews.update.many': async (state) => ({ data: { id: 'review-1', ...state.payload }, error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;

    const reviewController = (await import('../src/controllers/reviewController.js')).runPrReview;
    const app = express();
    app.use(express.json());
    app.post('/api/repos/:repoId/pulls/:number/reviews', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, reviewController);
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .post('/api/repos/repo-1/pulls/42/reviews')
      .expect(200);

    expect(res.text).toContain('data:');
    expect(res.text).toContain('review_id');
    expect(res.text).toContain('"type":"finding"');
    expect(supabaseCallLog).toContain('pr_reviews.upsert.maybeSingle');
    expect(globalThis.__CODELENS_NOTIFICATION_EVENTS__[0].type).toBe('pr_review.ready');
  });

  it('POST /api/repos/:repoId/pulls/:number/reviews validates request prerequisites before opening SSE', async () => {
    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1', full_name: 'owner/repo' }, error: null }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;
    globalThis.__CODELENS_GITHUB_TOKEN__ = null;

    const reviewController = (await import('../src/controllers/reviewController.js')).runPrReview;
    const app = express();
    app.use(express.json());
    app.post('/api/repos/:repoId/pulls/:number/reviews', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, reviewController);

    await request(app)
      .post('/api/repos/repo-1/pulls/not-a-number/reviews')
      .expect(400);

    await request(app)
      .post('/api/repos/repo-1/pulls/42/reviews')
      .expect(401);

    expect(supabaseCallLog).not.toContain('pr_reviews.upsert.maybeSingle');
  });

  it('PR review pipeline filters unchanged, existing, and suppressed deterministic findings', async () => {
    const sent = [];
    const baseContent = "eval('old');\nconst ok = true;\n";
    const headContent = "eval('old');\neval('new');\nconst token = 'abcdefghijklmnopqrstuvwxyz1234567890';\n";
    octokitMockState.pullsGetResult = { data: { head: { sha: 'headsha456' }, base: { sha: 'basesha456' } } };
    octokitMockState.listFilesResult = {
      data: [{
        filename: 'src/index.js',
        additions: 2,
        patch: "@@ -1,2 +1,3 @@\n eval('old');\n+eval('new');\n+const token = 'abcdefghijklmnopqrstuvwxyz1234567890';\n const ok = true;\n",
      }],
    };
    globalThis.__CODELENS_OCTOKIT__ = {
      Octokit: class {
        get rest() {
          return {
            pulls: {
              get: async () => octokitMockState.pullsGetResult,
              listFiles: async () => octokitMockState.listFilesResult,
            },
            repos: {
              getContent: async ({ ref }) => ({
                data: {
                  content: Buffer.from(ref === 'basesha456' ? baseContent : headContent).toString('base64'),
                  encoding: 'base64',
                },
              }),
            },
          };
        }
        get paginate() {
          return { iterator: async function* () { yield { data: octokitMockState.listFilesResult.data }; } };
        }
      },
    };

    supabaseAdminMock = createSupabaseMock({
      'issue_suppressions.select.many': async () => ({ data: [{ file_path: 'src/index.js', rule_id: 'generic_high_entropy', line_number: null }], error: null }),
      'analysis_issues.select.many': async () => ({
        data: [{ id: 'existing-js-eval', type: 'insecure_pattern', severity: 'high', description: '[Line 2] Use of eval() (Rule ID: js_eval)', file_paths: ['src/index.js'] }],
        error: null,
      }),
      'graph_edges.select.many': async () => ({ data: [], error: null }),
      'graph_nodes.select.many': async () => ({ data: [{ file_path: 'src/index.js' }], error: null }),
      'pr_reviews.upsert.maybeSingle': async (state) => ({ data: { id: 'review-2', ...state.payload }, error: null }),
      'pr_reviews.update.many': async () => ({ data: null, error: null }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const { runPrReviewBackground } = await import('../src/controllers/reviewController.js');
    const result = await runPrReviewBackground({
      repoId: 'repo-1',
      prNumber: 42,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'gh-token',
      userId: 'user-1',
      send: (event) => sent.push(event),
    });

    expect(result.reviewId).toBe('review-2');
    expect(sent.filter((event) => event.type === 'finding')).toHaveLength(0);
    expect(globalThis.__CODELENS_NOTIFICATION_EVENTS__[0].type).toBe('pr_review.ready');
  });

  it('PR review pipeline suppresses auth coverage findings already present in the PR base', async () => {
    const sent = [];
    const baseContent = "const express = require('express');\nconst router = express.Router();\nrouter.get('/admin', handler);\n";
    const headContent = `${baseContent}// unrelated route file comment\n`;
    octokitMockState.pullsGetResult = { data: { head: { sha: 'headauth' }, base: { sha: 'baseauth' } } };
    octokitMockState.listFilesResult = {
      data: [{
        filename: 'src/routes.js',
        additions: 1,
        patch: "@@ -1,3 +1,4 @@\n const express = require('express');\n const router = express.Router();\n router.get('/admin', handler);\n+// unrelated route file comment\n",
      }],
    };
    globalThis.__CODELENS_OCTOKIT__ = {
      Octokit: class {
        get rest() {
          return {
            pulls: {
              get: async () => octokitMockState.pullsGetResult,
              listFiles: async () => octokitMockState.listFilesResult,
            },
            repos: {
              getContent: async ({ ref }) => ({
                data: {
                  content: Buffer.from(ref === 'baseauth' ? baseContent : headContent).toString('base64'),
                  encoding: 'base64',
                },
              }),
            },
          };
        }
        get paginate() {
          return { iterator: async function* () { yield { data: octokitMockState.listFilesResult.data }; } };
        }
      },
    };

    supabaseAdminMock = createSupabaseMock({
      'issue_suppressions.select.many': async () => ({ data: [], error: null }),
      'analysis_issues.select.many': async () => ({ data: [], error: null }),
      'graph_edges.select.many': async () => ({ data: [], error: null }),
      'graph_nodes.select.many': async () => ({ data: [], error: null }),
      'pr_reviews.upsert.maybeSingle': async (state) => ({ data: { id: 'review-auth', ...state.payload }, error: null }),
      'pr_reviews.update.many': async () => ({ data: null, error: null }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const { runPrReviewBackground } = await import('../src/controllers/reviewController.js');
    await runPrReviewBackground({
      repoId: 'repo-1',
      prNumber: 42,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'gh-token',
      userId: 'user-1',
      send: (event) => sent.push(event),
    });

    expect(sent.filter((event) => event.type === 'finding')).toHaveLength(0);
  });

  it('PR review marks an existing review row failed when persistence fails after creation', async () => {
    const sent = [];
    octokitMockState.pullsGetResult = { data: { head: { sha: 'headsha789' }, base: { sha: 'basesha789' } } };
    octokitMockState.listFilesResult = { data: [] };
    globalThis.__CODELENS_OCTOKIT__ = {
      Octokit: class {
        get rest() {
          return {
            pulls: { get: async () => octokitMockState.pullsGetResult, listFiles: async () => octokitMockState.listFilesResult },
            repos: { getContent: async () => ({ data: { content: '', encoding: 'base64' } }) },
          };
        }
        get paginate() {
          return { iterator: async function* () { yield { data: [] }; } };
        }
      },
    };

    const updatePayloads = [];
    supabaseAdminMock = createSupabaseMock({
      'issue_suppressions.select.many': async () => ({ data: [], error: null }),
      'analysis_issues.select.many': async () => ({ data: [], error: null }),
      'pr_reviews.upsert.maybeSingle': async (state) => ({ data: { id: 'review-3', ...state.payload }, error: null }),
      'pr_reviews.update.many': async (state) => {
        updatePayloads.push(state.payload);
        if (state.payload.status === 'ready') return { data: null, error: { message: 'write failed' } };
        return { data: null, error: null };
      },
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const { runPrReviewBackground } = await import('../src/controllers/reviewController.js');
    const result = await runPrReviewBackground({
      repoId: 'repo-1',
      prNumber: 42,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'gh-token',
      userId: 'user-1',
      send: (event) => sent.push(event),
    });

    expect(result).toBeNull();
    expect(updatePayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'failed', summary: expect.stringContaining('Failed to update PR review') }),
    ]));
    expect(sent).toContainEqual(expect.objectContaining({ type: 'error' }));
  });

  it('Large PR reviews emit truncated and analyze only the top 50 files by additions', async () => {
    const files = Array.from({ length: 51 }, (_, i) => ({
      filename: `src/file-${i}.js`,
      additions: i,
      patch: `@@ -0,0 +1,1 @@\n+const value${i} = ${i};\n`,
    }));
    const sent = [];
    octokitMockState.pullsGetResult = { data: { head: { sha: 'headsha999' }, base: { sha: 'basesha999' } } };
    octokitMockState.listFilesResult = { data: files };
    globalThis.__CODELENS_OCTOKIT__ = {
      Octokit: class {
        get rest() {
          return {
            pulls: { get: async () => octokitMockState.pullsGetResult, listFiles: async () => octokitMockState.listFilesResult },
            repos: { getContent: async () => ({ data: { content: Buffer.from('const ok = true;\n').toString('base64'), encoding: 'base64' } }) },
          };
        }
        get paginate() {
          return { iterator: async function* () { yield { data: files }; } };
        }
      },
    };
    supabaseAdminMock = createSupabaseMock({
      'issue_suppressions.select.many': async () => ({ data: [], error: null }),
      'analysis_issues.select.many': async () => ({ data: [], error: null }),
      'graph_edges.select.many': async () => ({ data: [], error: null }),
      'graph_nodes.select.many': async () => ({ data: [], error: null }),
      'pr_reviews.upsert.maybeSingle': async (state) => ({ data: { id: 'review-4', ...state.payload }, error: null }),
      'pr_reviews.update.many': async () => ({ data: null, error: null }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const { runPrReviewBackground } = await import('../src/controllers/reviewController.js');
    await runPrReviewBackground({
      repoId: 'repo-1',
      prNumber: 42,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'gh-token',
      userId: 'user-1',
      send: (event) => sent.push(event),
    });

    expect(sent).toContainEqual({ type: 'truncated', total_files: 51, analyzed_files: 50 });
    const analyzedFiles = sent.filter((event) => event.type === 'analyzing_file').map((event) => event.file);
    expect(analyzedFiles).toHaveLength(50);
    expect(analyzedFiles).toContain('src/file-50.js');
    expect(analyzedFiles).not.toContain('src/file-0.js');
  });

  it('POST /api/repos/:repoId/reviews/:reviewId/publish posts one GitHub review and persists returned ids', async () => {
    const githubCalls = [];
    globalThis.__CODELENS_GITHUB_TOKEN__ = 'owner-token';
    globalThis.__CODELENS_OCTOKIT__ = {
      Octokit: class {
        get rest() {
          return {
            pulls: {
              listFiles: async () => ({ data: [{ filename: 'src/index.js', patch: '@@ -1,1 +1,1 @@\n+eval(input)\n' }] }),
              createReview: async (payload) => {
                githubCalls.push(['createReview', payload]);
                return { data: { id: 9001 } };
              },
              listCommentsForReview: async (payload) => {
                githubCalls.push(['listCommentsForReview', payload]);
                return { data: [{ id: 7001, path: 'src/index.js', line: 1 }] };
              },
              updateReviewComment: async (payload) => githubCalls.push(['updateReviewComment', payload]),
              deleteReviewComment: async (payload) => githubCalls.push(['deleteReviewComment', payload]),
              updateReview: async (payload) => githubCalls.push(['updateReview', payload]),
            },
          };
        }
        get paginate() {
          return { iterator: async function* () { yield { data: [{ filename: 'src/index.js', patch: '@@ -1,1 +1,1 @@\n+eval(input)\n' }] }; } };
        }
      },
    };

    let insertedRows = [];
    supabaseAdminMock = createSupabaseMock({
      'pr_reviews.select.maybeSingle': async () => ({
        data: {
          id: 'review-1',
          repo_id: 'repo-1',
          pr_number: 42,
          pr_head_sha: 'head',
          status: 'ready',
          findings_json: [
            { id: 'f1', severity: 'critical', file_path: 'src/index.js', line_number: 1, rule_id: 'js_eval', message: 'Avoid eval.' },
            { id: 'f2', severity: 'medium', file_path: 'src/routes.js', line_number: null, rule_id: 'missing_auth', message: 'Missing auth.' },
          ],
          severity_counts: { critical: 1, high: 0, medium: 1, low: 0 },
        },
        error: null,
      }),
      'repositories.select.maybeSingle': async () => ({
        data: { id: 'repo-1', user_id: 'owner-user', full_name: 'owner/repo', source: 'github', pr_review_block_on_severity: 'critical' },
        error: null,
      }),
      'pr_review_comments.select.many': async () => ({
        data: [
          { review_id: 'old-review', github_comment_id: 6001, file_path: 'src/index.js', line_number: 1, kind: 'inline' },
          { review_id: 'old-review', github_comment_id: 6002, file_path: null, line_number: null, kind: 'summary' },
        ],
        error: null,
      }),
      'pr_review_comments.insert.many': async (state) => {
        insertedRows = state.payload;
        return { data: state.payload, error: null };
      },
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;
    globalThis.__CODELENS_SUPABASE_ANON__ = supabaseAdminMock;

    const reviewController = await import('../src/controllers/reviewController.js');
    const app = express();
    app.use(express.json());
    app.post('/api/repos/:repoId/reviews/:reviewId/publish', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, reviewController.publishPrReviewEndpoint);

    const res = await request(app)
      .post('/api/repos/repo-1/reviews/review-1/publish')
      .expect(200);

    expect(res.body).toEqual(expect.objectContaining({ ok: true, github_review_id: 9001, event: 'REQUEST_CHANGES', inline_comments: 1, summary_items: 1 }));
    const createPayload = githubCalls.find(([name]) => name === 'createReview')[1];
    expect(createPayload.comments).toHaveLength(1);
    expect(createPayload.comments[0]).toEqual(expect.objectContaining({ path: 'src/index.js', line: 1, side: 'RIGHT' }));
    expect(createPayload.comments[0].body).toContain('Rule: `js_eval`');
    expect(createPayload.comments[0].body).toContain('/repo/repo-1?tab=pulls&review=review-1');
    expect(createPayload.body).toContain('Missing auth.');
    expect(githubCalls.map(([name]) => name)).not.toContain('listReviewComments');
    expect(githubCalls.map(([name]) => name)).toEqual(expect.arrayContaining(['updateReviewComment', 'updateReview', 'createReview', 'listCommentsForReview']));
    expect(githubCalls.find(([name]) => name === 'listCommentsForReview')[1]).toEqual(expect.objectContaining({ review_id: 9001 }));
    expect(insertedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ github_comment_id: 9001, kind: 'summary' }),
      expect.objectContaining({ github_comment_id: 7001, kind: 'inline', file_path: 'src/index.js', line_number: 1 }),
    ]));
  });

  it('PR review publish maps GitHub 422 after retrying once', async () => {
    let createAttempts = 0;
    globalThis.__CODELENS_GITHUB_TOKEN__ = 'owner-token';
    globalThis.__CODELENS_OCTOKIT__ = {
      Octokit: class {
        get rest() {
          return {
            pulls: {
              createReview: async () => {
                createAttempts += 1;
                const err = new Error('Validation Failed');
                err.status = 422;
                throw err;
              },
            },
          };
        }
        get paginate() {
          return { iterator: async function* () {} };
        }
      },
    };
    supabaseAdminMock = createSupabaseMock({
      'pr_reviews.select.maybeSingle': async () => ({
        data: { id: 'review-1', repo_id: 'repo-1', pr_number: 42, status: 'ready', findings_json: [], severity_counts: {} },
        error: null,
      }),
      'repositories.select.maybeSingle': async () => ({
        data: { id: 'repo-1', user_id: 'owner-user', full_name: 'owner/repo', source: 'github', pr_review_block_on_severity: 'high' },
        error: null,
      }),
      'pr_review_comments.select.many': async () => ({ data: [], error: null }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const reviewController = await import('../src/controllers/reviewController.js');
    const app = express();
    app.use(express.json());
    app.post('/api/repos/:repoId/reviews/:reviewId/publish', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, reviewController.publishPrReviewEndpoint);

    const res = await request(app)
      .post('/api/repos/repo-1/reviews/review-1/publish')
      .expect(422);

    expect(createAttempts).toBe(2);
    expect(res.body).toEqual(expect.objectContaining({ code: 'github_validation_failed' }));
  });

  it('PR review auto-publishes when enabled and keeps ready review usable when publish fails', async () => {
    const sent = [];
    let createAttempts = 0;
    octokitMockState.pullsGetResult = { data: { head: { sha: 'head-auto' }, base: { sha: 'base-auto' } } };
    octokitMockState.listFilesResult = { data: [] };
    globalThis.__CODELENS_GITHUB_TOKEN__ = 'owner-token';
    globalThis.__CODELENS_OCTOKIT__ = {
      Octokit: class {
        get rest() {
          return {
            pulls: {
              get: async () => octokitMockState.pullsGetResult,
              listFiles: async () => octokitMockState.listFilesResult,
              createReview: async () => {
                createAttempts += 1;
                const err = new Error('Forbidden');
                err.status = 403;
                throw err;
              },
            },
            repos: { getContent: async () => ({ data: { content: '', encoding: 'base64' } }) },
          };
        }
        get paginate() {
          return { iterator: async function* () { yield { data: [] }; } };
        }
      },
    };
    supabaseAdminMock = createSupabaseMock({
      'issue_suppressions.select.many': async () => ({ data: [], error: null }),
      'analysis_issues.select.many': async () => ({ data: [], error: null }),
      'pr_reviews.upsert.maybeSingle': async (state) => ({ data: { id: 'review-auto', ...state.payload }, error: null }),
      'pr_reviews.update.many': async () => ({ data: null, error: null }),
      'repositories.select.maybeSingle': async (state) => {
        if (String(state.columns).includes('pr_review_auto_publish')) return { data: { pr_review_auto_publish: true }, error: null };
        return { data: { id: 'repo-1', user_id: 'owner-user', full_name: 'owner/repo', source: 'github', pr_review_block_on_severity: 'critical' }, error: null };
      },
      'pr_reviews.select.maybeSingle': async () => ({
        data: { id: 'review-auto', repo_id: 'repo-1', pr_number: 42, status: 'ready', findings_json: [], severity_counts: {} },
        error: null,
      }),
      'pr_review_comments.select.many': async () => ({ data: [], error: null }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const { runPrReviewBackground } = await import('../src/controllers/reviewController.js');
    const result = await runPrReviewBackground({
      repoId: 'repo-1',
      prNumber: 42,
      owner: 'owner',
      repo: 'repo',
      githubToken: 'gh-token',
      userId: 'user-1',
      send: (event) => sent.push(event),
    });

    expect(result.reviewId).toBe('review-auto');
    expect(createAttempts).toBe(1);
    expect(sent).toContainEqual(expect.objectContaining({ type: 'done', review_id: 'review-auto' }));
  });

  it('GitHub pull_request webhook queues PR reviews without requiring a push ref', async () => {
    const { queue } = require('../src/services/queue');
    const queueSpy = vi.spyOn(queue, 'add').mockImplementation(() => {});
    const secret = 'webhook-secret';
    const payload = {
      action: 'opened',
      repository: { full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } },
      pull_request: { number: 42 },
    };
    const raw = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex')}`;

    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({
        data: {
          id: 'repo-1',
          user_id: 'user-1',
          webhook_secret: secret,
          default_branch: 'main',
          full_name: 'owner/repo',
          name: 'repo',
          source: 'github',
          pr_review_enabled: true,
        },
        error: null,
      }),
      'profiles.select.single': async () => ({ data: { github_token_secret_id: 'secret-1' }, error: null }),
      'rpc.get_github_token_secret': async () => ({ data: 'gh-token', error: null }),
    });

    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const webhookController = (await import('../src/controllers/webhookController.js')).default || await import('../src/controllers/webhookController.js');
    const app = express();
    app.post('/api/webhooks/github', express.raw({ type: '*/*' }), webhookController.handleGitHubPush);

    await request(app)
      .post('/api/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-hub-signature-256', signature)
      .send(raw)
      .expect(200);

    expect(queueSpy).toHaveBeenCalledWith('pr-review', expect.objectContaining({
      repoId: 'repo-1',
      prId: 42,
      owner: 'owner',
      name: 'repo',
      token: 'gh-token',
      userId: 'user-1',
    }), expect.any(Object));
    queueSpy.mockRestore();
  });

  it('GitHub pull_request webhook skips disabled repos', async () => {
    const { queue } = require('../src/services/queue');
    const queueSpy = vi.spyOn(queue, 'add').mockImplementation(() => {});
    const secret = 'webhook-secret';
    const payload = {
      action: 'opened',
      repository: { full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } },
      pull_request: { number: 42 },
    };
    const raw = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex')}`;

    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({
        data: {
          id: 'repo-1',
          user_id: 'user-1',
          webhook_secret: secret,
          default_branch: 'main',
          full_name: 'owner/repo',
          name: 'repo',
          source: 'github',
          pr_review_enabled: false,
        },
        error: null,
      }),
      'profiles.select.single': async () => ({ data: { github_token_secret_id: 'secret-1' }, error: null }),
      'rpc.get_github_token_secret': async () => ({ data: 'gh-token', error: null }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const webhookController = (await import('../src/controllers/webhookController.js')).default || await import('../src/controllers/webhookController.js');
    const app = express();
    app.post('/api/webhooks/github', express.raw({ type: '*/*' }), webhookController.handleGitHubPush);

    await request(app)
      .post('/api/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-github-event', 'pull_request')
      .set('x-hub-signature-256', signature)
      .send(raw)
      .expect(200);

    expect(queueSpy).not.toHaveBeenCalled();
    queueSpy.mockRestore();
  });

  it('GitHub push webhook keeps default-branch indexing behavior with repo name', async () => {
    const { queue } = require('../src/services/queue');
    const queueSpy = vi.spyOn(queue, 'add').mockImplementation(() => {});
    const secret = 'webhook-secret';
    let selectedColumns = '';
    const payload = {
      ref: 'refs/heads/main',
      repository: { full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } },
      commits: [{ id: 'commit-1' }],
    };
    const raw = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex')}`;

    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async (state) => {
        selectedColumns = state.columns;
        return {
          data: {
            id: 'repo-1',
            user_id: 'user-1',
            webhook_secret: secret,
            default_branch: 'main',
            full_name: 'owner/repo',
            name: 'repo',
            source: 'github',
            auto_sync_enabled: true,
            pr_review_enabled: false,
          },
          error: null,
        };
      },
      'profiles.select.single': async () => ({ data: { github_token_secret_id: 'secret-1' }, error: null }),
      'rpc.get_github_token_secret': async () => ({ data: 'gh-token', error: null }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const webhookController = (await import('../src/controllers/webhookController.js')).default || await import('../src/controllers/webhookController.js');
    const app = express();
    app.post('/api/webhooks/github', express.raw({ type: '*/*' }), webhookController.handleGitHubPush);

    await request(app)
      .post('/api/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-github-event', 'push')
      .set('x-hub-signature-256', signature)
      .send(raw)
      .expect(200);

    expect(selectedColumns).toContain('name');
    expect(queueSpy).toHaveBeenCalledWith(expect.any(Function));
    queueSpy.mockRestore();
  });

  it('GitHub push webhook skips re-index when auto-sync is disabled', async () => {
    const { queue } = require('../src/services/queue');
    const queueSpy = vi.spyOn(queue, 'add').mockImplementation(() => {});
    const secret = 'webhook-secret';
    const payload = {
      ref: 'refs/heads/main',
      repository: { full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' } },
      commits: [{ id: 'commit-1' }],
    };
    const raw = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex')}`;

    supabaseAdminMock = createSupabaseMock({
      'repositories.select.maybeSingle': async () => ({
        data: {
          id: 'repo-1',
          user_id: 'user-1',
          webhook_secret: secret,
          default_branch: 'main',
          full_name: 'owner/repo',
          name: 'repo',
          source: 'github',
          auto_sync_enabled: false,
          pr_review_enabled: false,
        },
        error: null,
      }),
      'profiles.select.single': async () => ({ data: { github_token_secret_id: 'secret-1' }, error: null }),
      'rpc.get_github_token_secret': async () => ({ data: 'gh-token', error: null }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const webhookController = (await import('../src/controllers/webhookController.js')).default || await import('../src/controllers/webhookController.js');
    const app = express();
    app.post('/api/webhooks/github', express.raw({ type: '*/*' }), webhookController.handleGitHubPush);

    const res = await request(app)
      .post('/api/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-github-event', 'push')
      .set('x-hub-signature-256', signature)
      .send(raw)
      .expect(200);

    expect(res.body).toEqual(expect.objectContaining({ skipped: 'auto-sync disabled' }));
    expect(queueSpy).not.toHaveBeenCalled();
    queueSpy.mockRestore();
  });

  it('US-072 schema keeps PR review persistence aligned with acceptance criteria', () => {
    // Normalize CRLF so the multi-line assertions below match on Windows checkouts.
    const schema = readFileSync(new URL('../../scripts/schema.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

    expect(schema).toContain("findings_json  JSONB NOT NULL DEFAULT '[]'::jsonb");
    expect(schema).toContain("CREATE TYPE pr_review_status AS ENUM ('pending', 'analyzing', 'ready', 'failed', 'stale')");
    expect(schema).toContain('pr_review_auto_publish BOOLEAN NOT NULL DEFAULT true');
    expect(schema).toContain("pr_review_block_on_severity TEXT NOT NULL DEFAULT 'critical'");
    expect(schema).toContain("CHECK (pr_review_block_on_severity IN ('critical', 'high'))");
    expect(schema).toContain('UNIQUE (repo_id, pr_number, pr_head_sha)');
    expect(schema).toContain('pr_reviews_repo_pr_created_idx ON pr_reviews (repo_id, pr_number, created_at DESC)');
    expect(schema).toContain("kind              TEXT NOT NULL CHECK (kind IN ('inline','summary'))");
    expect(schema).not.toContain("'off'");
    expect(schema).not.toContain("'review_event'");
    expect(schema).toContain('USING (can_access_repo(repo_id, auth.uid()))');
    expect(schema).toContain('ON pr_review_comments FOR ALL');
    expect(schema).toContain('AND can_access_repo(pr.repo_id, auth.uid())');
    expect(schema).toContain('WITH CHECK (\n    EXISTS (\n      SELECT 1 FROM pr_reviews pr');
  });

  // ─── US-076: CI tokens + CI check ──────────────────────────────────────────

  it('US-076 generates a CI token once and never returns the hash', async () => {
    process.env.CI_TOKEN_HMAC_SECRET = 'test-secret';
    supabaseAdminMock = createSupabaseMock({
      'rpc.can_access_repo': async () => ({ data: true, error: null }),
      'repo_api_tokens.insert.single': async (state) => ({
        data: { id: 'tok-1', name: state.payload.name, created_at: '2026-01-01T00:00:00Z' },
        error: null,
      }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const ciTokenController = (await import('../src/controllers/ciTokenController.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/repos/:repoId/ci-tokens', (req, _res, next) => { req.user = { id: 'user-1' }; next(); }, wrap(ciTokenController.createCiToken));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app).post('/api/repos/repo-1/ci-tokens').send({ name: 'CI token' }).expect(201);
    expect(res.body.token).toMatch(/^codelens_pat_/);
    expect(res.body).not.toHaveProperty('token_hash');
    expect(res.body.id).toBe('tok-1');
  });

  it('US-076 CI token middleware rejects a token scoped to a different repo', async () => {
    process.env.CI_TOKEN_HMAC_SECRET = 'test-secret';
    supabaseAdminMock = createSupabaseMock({
      'repo_api_tokens.select.maybeSingle': async () => ({ data: { id: 'tok-1', repo_id: 'repo-OTHER', revoked_at: null }, error: null }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const { requireCiToken } = (await import('../src/middleware/ciTokenAuth.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/repos/:repoId/x', requireCiToken, (req, res) => res.json({ ok: true }));

    await request(app)
      .post('/api/repos/repo-1/x')
      .set('Authorization', 'Bearer codelens_pat_abc')
      .expect(403);
  });

  it('US-076 ci-check returns fail when blocking findings exist for the head SHA', async () => {
    process.env.CI_TOKEN_HMAC_SECRET = 'test-secret';
    globalThis.__CODELENS_GITHUB_TOKEN__ = 'owner-token';
    globalThis.__CODELENS_OCTOKIT__ = {
      Octokit: class {
        get rest() {
          return { pulls: { get: async () => ({ data: { head: { sha: 'headsha123' }, base: { sha: 'base' } } }) } };
        }
      },
    };
    supabaseAdminMock = createSupabaseMock({
      'repo_api_tokens.select.maybeSingle': async () => ({ data: { id: 'tok-1', repo_id: 'repo-1', revoked_at: null }, error: null }),
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1', user_id: 'owner-user', full_name: 'owner/repo', source: 'github' }, error: null }),
      'pr_reviews.select.maybeSingle': async () => ({
        data: { id: 'review-1', status: 'ready', pr_number: 42, pr_head_sha: 'headsha123', findings_json: [], severity_counts: { critical: 1, high: 0, medium: 0, low: 0 } },
        error: null,
      }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const reviewController = await import('../src/controllers/reviewController.js');
    const { requireCiToken } = (await import('../src/middleware/ciTokenAuth.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/repos/:repoId/pulls/:number/reviews/ci-check', requireCiToken, wrap(reviewController.default.ciCheckReview));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const res = await request(app)
      .post('/api/repos/repo-1/pulls/42/reviews/ci-check')
      .set('Authorization', 'Bearer codelens_pat_abc')
      .send({ fail_on_severity: 'critical,high' })
      .expect(200);
    expect(res.body.status).toBe('fail');
    expect(res.body.severity_counts.critical).toBe(1);
    expect(res.body.codelens_url).toContain('review-1');
  });

  it('US-076 ci-check passes when no severity matches fail_on_severity', async () => {
    process.env.CI_TOKEN_HMAC_SECRET = 'test-secret';
    globalThis.__CODELENS_GITHUB_TOKEN__ = 'owner-token';
    globalThis.__CODELENS_OCTOKIT__ = {
      Octokit: class {
        get rest() {
          return { pulls: { get: async () => ({ data: { head: { sha: 'headsha123' }, base: { sha: 'base' } } }) } };
        }
      },
    };
    supabaseAdminMock = createSupabaseMock({
      'repo_api_tokens.select.maybeSingle': async () => ({ data: { id: 'tok-1', repo_id: 'repo-1', revoked_at: null }, error: null }),
      'repositories.select.maybeSingle': async () => ({ data: { id: 'repo-1', user_id: 'owner-user', full_name: 'owner/repo', source: 'github' }, error: null }),
      'pr_reviews.select.maybeSingle': async () => ({
        data: { id: 'review-2', status: 'ready', pr_number: 7, pr_head_sha: 'headsha123', findings_json: [], severity_counts: { critical: 0, high: 0, medium: 2, low: 1 } },
        error: null,
      }),
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const reviewController = await import('../src/controllers/reviewController.js');
    const { requireCiToken } = (await import('../src/middleware/ciTokenAuth.js')).default;
    const app = express();
    app.use(express.json());
    app.post('/api/repos/:repoId/pulls/:number/reviews/ci-check', requireCiToken, wrap(reviewController.default.ciCheckReview));

    const res = await request(app)
      .post('/api/repos/repo-1/pulls/7/reviews/ci-check')
      .set('Authorization', 'Bearer codelens_pat_abc')
      .send({ fail_on_severity: 'critical,high' })
      .expect(200);
    expect(res.body.status).toBe('pass');
  });

  // ─── US-077: notifications ─────────────────────────────────────────────────

  it('US-077 enqueueNotification skips users already notified for the same dedup_key', async () => {
    let inserted = null;
    supabaseAdminMock = createSupabaseMock({
      'notifications.select.many': async () => ({
        data: [{ user_id: 'user-1', payload_json: { dedup_key: 'k1' } }],
        error: null,
      }),
      'notifications.insert.many': async (state) => { inserted = state.payload; return { data: state.payload, error: null }; },
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const { enqueueNotification } = await import('../src/services/notifications.js');

    const skipped = await enqueueNotification({
      user_ids: ['user-1'], repo_id: 'repo-1', type: 'new_critical_issue', dedup_key: 'k1', payload: {},
    });
    expect(skipped).toBe(0);
    expect(inserted).toBeNull();

    const wrote = await enqueueNotification({
      user_ids: ['user-1'], repo_id: 'repo-1', type: 'new_critical_issue', dedup_key: 'k2', payload: {},
    });
    expect(wrote).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].payload_json.dedup_key).toBe('k2');
  });

  it('US-077 notification feed endpoints are user-scoped', async () => {
    const updates = [];
    supabaseAdminMock = createSupabaseMock({
      'notifications.select.many': async (state) => {
        // unread-count uses head/count; list returns rows
        if (state.columns === 'id') return { count: 3, data: null, error: null };
        return { data: [
          { id: 'n1', type: 'index_ready', severity: 'info', payload_json: {}, link_url: '/repo/r', read_at: null, created_at: '2026-01-02T00:00:00Z' },
          { id: 'n2', type: 'pr_review_ready', severity: 'warning', payload_json: {}, link_url: '/repo/r', read_at: null, created_at: '2026-01-01T00:00:00Z' },
        ], error: null };
      },
      'notifications.update.many': async (state) => { updates.push(state); return { data: null, error: null }; },
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = supabaseAdminMock;

    const notificationsController = (await import('../src/controllers/notificationsController.js')).default;
    const app = express();
    app.use(express.json());
    const inject = (req, _res, next) => { req.user = { id: 'user-1' }; next(); };
    app.get('/api/notifications', inject, wrap(notificationsController.listNotifications));
    app.get('/api/notifications/unread-count', inject, wrap(notificationsController.unreadCount));
    app.post('/api/notifications/mark-all-read', inject, wrap(notificationsController.markAllRead));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message || 'error' }));

    const list = await request(app).get('/api/notifications?limit=20').expect(200);
    expect(list.body.notifications).toHaveLength(2);
    expect(list.body.has_more).toBe(false);

    const count = await request(app).get('/api/notifications/unread-count').expect(200);
    expect(count.body.unread).toBe(3);

    await request(app).post('/api/notifications/mark-all-read').expect(200);
    expect(updates.length).toBe(1);
  });
});
