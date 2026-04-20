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
      'repositories.select.single': async () => ({ data: { id: 'repo-1', source: 'github', name: 'acme/repo' }, error: null }),
      'code_chunks.delete.many': async () => ({ data: null, error: null }),
      'analysis_issues.delete.many': async () => ({ data: null, error: null }),
      'graph_edges.delete.many': async () => ({ data: null, error: null }),
      'graph_nodes.delete.many': async () => ({ data: null, error: null }),
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
      'repositories.select.single': async () => ({ data: { id: 'repo-1', status: 'ready' }, error: null }),
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
});
