/**
 * GitHub token helper — pulls the user's GitHub PAT out of Supabase Vault
 * via the get_github_token_secret RPC (US-039). Centralised so callers
 * outside repoController.js don't have to know about the secret_id indirection.
 */

const { supabaseAdmin } = require('../db/supabase');

async function getGithubTokenForUser(userId) {
  if (!userId) return null;
  if (globalThis.__CODELENS_GITHUB_TOKEN__) return globalThis.__CODELENS_GITHUB_TOKEN__;

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('github_token_secret_id')
    .eq('id', userId)
    .single();

  if (profileErr || !profile?.github_token_secret_id) return null;

  const { data: tokenData, error: tokenErr } = await supabaseAdmin.rpc(
    'get_github_token_secret',
    { secret_id: profile.github_token_secret_id },
  );

  if (tokenErr || !tokenData) return null;
  return tokenData;
}

module.exports = { getGithubTokenForUser };
