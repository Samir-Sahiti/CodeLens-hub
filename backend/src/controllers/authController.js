/**
 * Auth controller
 */
const { supabaseAdmin } = require('../db/supabase');

/**
 * POST /api/auth/profile  (protected by requireAuth)
 * Upserts the profiles row for the signed-in user.
 * Called by the frontend immediately after a fresh GitHub sign-in
 * to persist the provider_token (GitHub access token).
 */
const upsertProfile = async (req, res) => {
  const { github_access_token, github_username } = req.body;
  const userId = req.user.id;

  const { error } = await supabaseAdmin
    .from('profiles')
    .upsert(
      {
        id: userId,
        github_access_token: github_access_token ?? null,
        github_username:     github_username     ?? null,
      },
      { onConflict: 'id' }
    );

  if (error) {
    console.error('[upsertProfile]', error);
    return res.status(500).json({ error: 'Failed to save profile' });
  }

  // Auto-join teams: if any team_members rows reference this GitHub username
  // but have no user_id yet, backfill them now so the new user instantly sees
  // shared repos on their dashboard.
  if (github_username) {
    const { error: teamJoinErr } = await supabaseAdmin
      .from('team_members')
      .update({ user_id: userId })
      .eq('github_username', github_username)
      .is('user_id', null);

    if (teamJoinErr) {
      // Non-fatal — log and continue
      console.error('[upsertProfile] team auto-join failed:', teamJoinErr);
    }
  }

  res.json({ ok: true });
};

/**
 * GET /api/auth/me  (protected by requireAuth)
 * Returns the currently authenticated user object.
 * The requireAuth middleware already validated the JWT and attached req.user.
 */
const getMe = async (req, res) => {
  res.json({ user: req.user });
};

/**
 * POST /api/auth/signout
 * Supabase JWTs are stateless — the token expires on its own.
 * The frontend just calls supabase.auth.signOut() to clear localStorage.
 * This endpoint is a no-op server-side but kept for convention.
 */
const signOut = async (req, res) => {
  res.json({ message: 'Signed out' });
};

module.exports = { upsertProfile, getMe, signOut };
