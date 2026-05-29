/**
 * Repo access check — thin wrapper over the can_access_repo RPC.
 *
 * Lives in lib/ rather than controllers/ so service-layer modules (graph,
 * files, agent tools) can import it without creating a circular dependency
 * through repoController.
 */

const { supabaseAdmin } = require('../db/supabase');

async function canAccessRepo(repoId, userId) {
  if (!repoId || !userId) return false;
  const { data, error } = await supabaseAdmin.rpc('can_access_repo', {
    p_repo_id: repoId,
    p_user_id: userId,
  });
  if (error) {
    console.warn('[canAccessRepo] RPC failed:', error.message);
    return false;
  }
  return Boolean(data);
}

module.exports = { canAccessRepo };
