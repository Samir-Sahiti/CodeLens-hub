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

const SUPABASE_URL              = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Ensure SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are set in .env'
  );
}

/** Anon client – RLS enforced */
const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Admin client – RLS bypassed (server-side only) */
const _supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession:   false,
  },
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
