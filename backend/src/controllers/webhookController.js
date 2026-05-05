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
 * POST /api/webhooks/github
 *
 * Receives a GitHub push event, validates the HMAC-SHA256 signature,
 * and triggers re-indexing if the push is to the repo's default branch.
 *
 * Must be mounted BEFORE express.json() so that req.body is the raw Buffer.
 */
const handleGitHubPush = async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'];
  const rawBody = req.body; // Buffer (set by express.raw middleware on this route)

  // Process push and pull_request events
  if (event !== 'push' && event !== 'pull_request') {
    return res.status(200).json({ ok: true, skipped: 'not a push or pull_request event' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const fullName = payload?.repository?.full_name;
  const ref = payload?.ref;

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
    Buffer.from(expected, 'utf8')
  );

  if (!isValid) {
    return res.status(403).json({ error: 'Invalid webhook signature' });
  }

  // Fetch the repo owner's GitHub token from Vault early
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('github_token_secret_id')
    .eq('id', repo.user_id)
    .single();

  let githubToken = null;
  if (profile?.github_token_secret_id) {
    const { data: tokenData } = await supabaseAdmin.rpc('get_github_token_secret', {
      secret_id: profile.github_token_secret_id,
    });
    githubToken = tokenData;
  }

  if (!githubToken) {
    console.error(`[webhook] No GitHub token for user ${repo.user_id}`);
    return res.status(200).json({ ok: true, skipped: 'no GitHub token found for repo owner' });
  }

  const { queue } = require('../services/queue');

  if (event === 'pull_request') {
    const action = payload.action;
    if (!['opened', 'synchronize'].includes(action)) {
      return res.status(200).json({ ok: true, skipped: 'ignored PR action' });
    }
    
    console.log(`[webhook] Queuing PR diff for repo ${repo.id} PR #${payload.pull_request.number}`);
    
    // Enqueue the PR Diff Job (US-051)
    queue.add('pr-diff', {
      repoId: repo.id,
      prId: payload.pull_request.number,
      owner: payload.repository.owner.login,
      name: payload.repository.name,
      baseRef: payload.pull_request.base.sha,
      headRef: payload.pull_request.head.sha,
      token: githubToken
    }, { timeout: 5 * 60 * 1000 });
    
    return res.status(200).send("OK");
  }

  // Only re-index pushes to the default branch
  const defaultRef = `refs/heads/${repo.default_branch || 'main'}`;
  if (ref !== defaultRef) {
    return res.status(200).json({ ok: true, skipped: 'push not to default branch' });
  }

  // Fire-and-forget re-index (US-028)
  console.log(`[webhook] Triggering re-index for repo ${repo.id} (${fullName}) on push to ${ref}`);
  
  queue.add(async () => {
    await indexer.startGitHubIndexing(repo.id, githubToken, repo.name);
  });

  return res.status(200).send("OK");
};

module.exports = { handleGitHubPush };
