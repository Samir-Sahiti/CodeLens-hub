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

  const { data: existingProfile } = await supabaseAdmin
    .from('profiles')
    .select('github_token_secret_id')
    .eq('id', userId)
    .maybeSingle();

  let secret_id = existingProfile?.github_token_secret_id ?? null;
  if (github_access_token) {
    const { data, error } = await supabaseAdmin.rpc('create_github_token_secret', { token: github_access_token });
    if (error) {
      console.error('[upsertProfile] vault error:', error);
      return res.status(500).json({ error: 'Failed to securely store GitHub token' });
    }
    secret_id = data;
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .upsert(
      {
        id: userId,
        github_token_secret_id: secret_id ?? null,
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
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('onboarding_seen')
    .eq('id', req.user.id)
    .maybeSingle();

  if (error) {
    console.error('[getMe] profile lookup failed:', error);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }

  res.json({
    user: req.user,
    onboarding_seen: profile?.onboarding_seen ?? null,
  });
};

/**
 * POST /api/auth/onboarding-seen  (protected by requireAuth)
 * Marks the static onboarding guide as dismissed for this user.
 */
const markOnboardingSeen = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .upsert(
      { id: req.user.id, onboarding_seen: new Date().toISOString() },
      { onConflict: 'id' }
    )
    .select('onboarding_seen')
    .single();

  if (error) {
    console.error('[markOnboardingSeen]', error);
    return res.status(500).json({ error: 'Failed to update onboarding state' });
  }

  res.json({ onboarding_seen: data.onboarding_seen });
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

module.exports = { upsertProfile, getMe, markOnboardingSeen, signOut };
