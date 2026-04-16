/**
 * Webhook controller — handles incoming GitHub push events.
 * This endpoint is called by GitHub, not by the authenticated user,
 * so it does NOT use the requireAuth middleware.
 */
const crypto = require('crypto');
const { supabaseAdmin } = require('../db/supabase');
const indexer = require('../services/indexer');

/**
 * POST /api/webhooks/github
 *
 * Receives a GitHub push event, validates the HMAC-SHA256 signature,
 * and triggers re-indexing if the push is to the repo's default branch.
 *
 * Must be mounted BEFORE express.json() so that req.body is the raw Buffer.
 */
const handleGitHubPush = async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const event     = req.headers['x-github-event'];
  const rawBody   = req.body; // Buffer (set by express.raw middleware on this route)

  // Only process push events
  if (event !== 'push') {
    return res.status(200).json({ ok: true, skipped: 'not a push event' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const fullName = payload?.repository?.full_name;
  const ref      = payload?.ref;

  if (!fullName || !ref) {
    return res.status(400).json({ error: 'Missing repository.full_name or ref in payload' });
  }

  // Look up the repo by name (stored as "owner/repo") with auto_sync_enabled = true
  const { data: repo, error: fetchError } = await supabaseAdmin
    .from('repositories')
    .select('id, user_id, webhook_secret, default_branch, name, source')
    .eq('name', fullName)
    .eq('auto_sync_enabled', true)
    .eq('source', 'github')
    .maybeSingle();

  if (fetchError || !repo) {
    // Return 200 to avoid GitHub marking the webhook as failed
    return res.status(200).json({ ok: true, skipped: 'repo not found or auto-sync disabled' });
  }

  // Validate the HMAC-SHA256 signature
  if (!repo.webhook_secret || !signature) {
    return res.status(403).json({ error: 'Webhook secret not configured or missing signature' });
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', repo.webhook_secret)
    .update(rawBody)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expected,  'utf8')
  );

  if (!isValid) {
    return res.status(403).json({ error: 'Invalid webhook signature' });
  }

  // Only re-index pushes to the default branch
  const defaultRef = `refs/heads/${repo.default_branch || 'main'}`;
  if (ref !== defaultRef) {
    return res.status(200).json({ ok: true, skipped: 'push not to default branch' });
  }

  // Fetch the repo owner's GitHub token
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('github_access_token')
    .eq('id', repo.user_id)
    .single();

  if (!profile?.github_access_token) {
    console.error(`[webhook] No GitHub token for user ${repo.user_id}`);
    return res.status(200).json({ ok: true, skipped: 'no GitHub token found for repo owner' });
  }

  // Fire-and-forget re-index — reuses the same pipeline as the manual Re-index button
  console.log(`[webhook] Triggering re-index for repo ${repo.id} (${fullName}) on push to ${ref}`);
  indexer.startGitHubIndexing(repo.id, profile.github_access_token, repo.name);

  res.status(200).json({ ok: true, reindexing: true });
};

module.exports = { handleGitHubPush };
