/**
 * Supabase browser client
 *
 * Import this anywhere in the frontend that needs to query Supabase directly
 * (e.g. auth state, realtime subscriptions). For data mutations, prefer
 * going through the Express API so business logic stays server-side.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnon);
