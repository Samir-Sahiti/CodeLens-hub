/**
 * Supabase client helpers
 *
 * Two clients are exported:
 *  - `supabase`      – anon key, respects Row Level Security. Use for operations
 *                      that run in the context of an authenticated user.
 *  - `supabaseAdmin` – service-role key, bypasses RLS. Use only for trusted
 *                      server-side operations (e.g. creating profiles on signup).
 */

const { createClient } = require('@supabase/supabase-js');
const { recordSupabaseCall } = require('../observability/requestStore');

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Ensure SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are set in .env'
  );
}

// Phase 0 observability: a custom fetch records every PostgREST round-trip into
// the AsyncLocalStorage ledger so the request-timing middleware can summarise
// "this endpoint spent 800ms across 7 DB calls — slowest was graph_nodes.upsert".
// Failing observably is worse than not measuring; the wrapper swallows its own errors.
function parseSupabaseRequest(url, init) {
  try {
    const u = typeof url === 'string' ? new URL(url) : url;
    const pathname = u.pathname || '';
    // PostgREST: /rest/v1/<table>?<filters>     RPC: /rest/v1/rpc/<name>
    const match = pathname.match(/\/rest\/v1\/(rpc\/)?([^/?]+)/);
    const isRpc = Boolean(match && match[1]);
    const table = match ? match[2] : pathname;
    const method = (init && init.method) || 'GET';
    return { table, method, isRpc, url: u.toString() };
  } catch {
    return { table: 'unknown', method: 'GET', isRpc: false, url: String(url) };
  }
}

function instrumentedFetch(...args) {
  const [url, init] = args;
  const meta = parseSupabaseRequest(url, init);
  const start = process.hrtime.bigint();
  return globalThis.fetch(url, init).then(
    (response) => {
      try {
        recordSupabaseCall({
          method: meta.method,
          table: meta.isRpc ? `rpc:${meta.table}` : meta.table,
          durationMs: Number(process.hrtime.bigint() - start) / 1e6,
          status: response.status,
        });
      } catch { /* swallow */ }
      return response;
    },
    (err) => {
      try {
        recordSupabaseCall({
          method: meta.method,
          table: meta.isRpc ? `rpc:${meta.table}` : meta.table,
          durationMs: Number(process.hrtime.bigint() - start) / 1e6,
          status: 0,
          error: err?.message,
        });
      } catch { /* swallow */ }
      throw err;
    }
  );
}

/** Anon client – RLS enforced */
const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: instrumentedFetch },
});

/** Admin client – RLS bypassed (server-side only) */
const _supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession:   false,
  },
  global: { fetch: instrumentedFetch },
});

// Proxies let tests inject mocks via globalThis at any point after module load.
// Controllers destructure these references once; the proxy intercepts each
// property access at call time so the active client is always correct.
function makeProxy(realClient, globalKey) {
  return new Proxy(realClient, {
    get(_target, prop) {
      const active = globalThis[globalKey] || realClient;
      const val = active[prop];
      return typeof val === 'function' ? val.bind(active) : val;
    },
  });
}

const supabase      = makeProxy(_supabase,      '__CODELENS_SUPABASE_ANON__');
const supabaseAdmin = makeProxy(_supabaseAdmin, '__CODELENS_SUPABASE_ADMIN__');

module.exports = { supabase, supabaseAdmin };
