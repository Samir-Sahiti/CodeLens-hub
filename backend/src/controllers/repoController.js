/**
 * Repository controller
 */
const crypto = require('crypto');
const { supabaseAdmin } = require('../db/supabase');
const _indexer = require('../services/indexer');
const indexer = new Proxy({}, {
  get: (_t, prop) => (globalThis.__CODELENS_INDEXER__ || _indexer)[prop],
});

/** POST /api/repos — connect a GitHub repo and trigger indexing */
const connectRepo = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Repo name is required' });

  // 1. Get user's github token from profiles
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('github_token_secret_id')
    .eq('id', req.user.id)
    .single();

  let githubToken = null;
  if (profile?.github_token_secret_id) {
    const { data: tokenData, error: tokenError } = await supabaseAdmin.rpc('get_github_token_secret', { secret_id: profile.github_token_secret_id });
    if (!tokenError && tokenData) {
      githubToken = tokenData;
    }
  }

  if (!githubToken) {
    return res.status(400).json({ error: 'GitHub token not found or could not be decrypted' });
  }

  // 2. Insert repository
  const { data: repo, error: insertError } = await supabaseAdmin
    .from('repositories')
    .insert({
      user_id: req.user.id,
      name,
      source: 'github',
      status: 'pending'
    })
    .select()
    .single();

  if (insertError) {
    console.error('[connectRepo]', insertError);
    return res.status(500).json({ error: 'Failed to save repository' });
  }

  // 3. Fire-and-forget background indexing
  indexer.startGitHubIndexing(repo.id, githubToken, name);

  res.json({ ok: true, repo });
};

/** POST /api/repos/upload — upload a local repository zip */
const uploadRepo = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No repository zip file uploaded' });
  }

  const name = req.file.originalname.replace('.zip', '');

  // 1. Insert repository record
  const { data: repo, error: insertError } = await supabaseAdmin
    .from('repositories')
    .insert({
      user_id: req.user.id,
      name,
      source: 'upload',
      status: 'pending'
    })
    .select()
    .single();

  if (insertError) {
    console.error('[uploadRepo]', insertError);
    return res.status(500).json({ error: 'Failed to save repository record' });
  }

  // 2. Fire-and-forget background indexing
  indexer.startLocalIndexing(repo.id, req.file.path, name);

  res.json({ ok: true, repo });
};

/** GET /api/repos — list repos owned by the user + repos shared via teams */
const listRepos = async (req, res) => {
  // Own repos
  const { data: ownedRepos, error: ownedErr } = await supabaseAdmin
    .from('repositories')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (ownedErr) {
    console.error('[listRepos] Error fetching own repos:', ownedErr);
    return res.status(500).json({ error: 'Failed to fetch repositories' });
  }

  // Team-shared repos: first get team IDs the user belongs to, then fetch repos
  const { data: memberships } = await supabaseAdmin
    .from('team_members')
    .select('team_id')
    .eq('user_id', req.user.id);

  const teamIds = (memberships || []).map((m) => m.team_id);

  let teamRepoRows = [];
  let teamErr = null;
  if (teamIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('team_repositories')
      .select('repo_id, repositories(*), teams(name)')
      .in('team_id', teamIds);
    teamRepoRows = data || [];
    teamErr = error;
  }

  if (teamErr) {
    console.error('[listRepos] Error fetching team repos:', teamErr);
    // Non-fatal: return own repos only
    return res.json({ repos: ownedRepos || [] });
  }

  const ownedIds = new Set((ownedRepos || []).map((r) => r.id));
  const sharedRepos = (teamRepoRows || [])
    .filter((row) => row.repositories && !ownedIds.has(row.repositories.id))
    .map((row) => ({
      ...row.repositories,
      shared: true,
      team_name: row.teams?.name || null,
    }));

  // Deduplicate shared repos (a repo can be in multiple teams)
  const sharedById = new Map();
  sharedRepos.forEach((r) => sharedById.set(r.id, r));

  const repos = [
    ...(ownedRepos || []),
    ...Array.from(sharedById.values()),
  ];

  res.json({ repos });
};

/** GET /api/repos/:repoId/status — polling endpoint for indexing progress */
const getStatus = async (req, res) => {
  const { repoId } = req.params;
  const { data, error } = await supabaseAdmin
    .from('repositories')
    .select('status, file_count')
    .eq('id', repoId)
    .eq('user_id', req.user.id)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Repository not found' });
  }

  res.json(data);
};

/** DELETE /api/repos/:repoId — remove repo and all related data */
const deleteRepo = async (req, res) => {
  const { repoId } = req.params;

  const { error } = await supabaseAdmin
    .from('repositories')
    .delete()
    .eq('id', repoId)
    .eq('user_id', req.user.id);

  if (error) {
    console.error('[deleteRepo] Error:', error);
    return res.status(500).json({ error: 'Failed to delete repository' });
  }

  res.json({ ok: true });
};

/** POST /api/repos/:repoId/reindex — re-trigger indexing on a repository */
const reindexRepo = async (req, res) => {
  const { repoId } = req.params;

  const { data: repo, error: fetchError } = await supabaseAdmin
    .from('repositories')
    .select('*')
    .eq('id', repoId)
    .eq('user_id', req.user.id)
    .single();

  if (fetchError || !repo) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  const tables = ['code_chunks', 'analysis_issues', 'graph_edges', 'graph_nodes'];

  for (const table of tables) {
    const { error: deleteError } = await supabaseAdmin
      .from(table)
      .delete()
      .eq('repo_id', repoId);

    if (deleteError) {
      console.error(`[reindexRepo] Failed deleting from ${table}:`, deleteError);
      return res.status(500).json({ error: 'Failed to clear previous indexing data' });
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from('repositories')
    .update({ status: 'pending', file_count: 0, indexed_at: null })
    .eq('id', repoId);

  if (updateError) {
    console.error('[reindexRepo] Failed to reset status:', updateError);
    return res.status(500).json({ error: 'Failed to restart repository indexing' });
  }

  if (repo.source === 'github') {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('github_token_secret_id')
      .eq('id', req.user.id)
      .single();

    if (profile?.github_access_token) {
      indexer.startGitHubIndexing(repo.id, profile.github_access_token, repo.name);
    } else {
      await supabaseAdmin.from('repositories').update({ status: 'failed' }).eq('id', repoId);
    }
  } else if (repo.source === 'upload') {
    return res.status(400).json({
      error: 'Re-indexing is not supported for uploaded repositories. Please delete and upload the ZIP again.'
    });
  }

  res.json({ ok: true, message: 'Re-indexing started' });
};

/**
 * Checks if the current user can access a given repo — either as owner or team member.
 */
async function canAccessRepo(repoId, userId) {
  // Owner check
  const { data: owned } = await supabaseAdmin
    .from('repositories')
    .select('id')
    .eq('id', repoId)
    .eq('user_id', userId)
    .maybeSingle();
  if (owned) return true;

  // Team membership check
  const { data: memberships } = await supabaseAdmin
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId);
  const teamIds = (memberships || []).map((m) => m.team_id);
  if (teamIds.length === 0) return false;

  const { data: teamRepo } = await supabaseAdmin
    .from('team_repositories')
    .select('repo_id')
    .eq('repo_id', repoId)
    .in('team_id', teamIds)
    .maybeSingle();

  return !!teamRepo;
}

/** GET /api/repos/:repoId/analysis — fetch nodes, edges, and issues in a single request */
const getAnalysisData = async (req, res) => {
  const { repoId } = req.params;
  console.log(`[getAnalysisData] Fetching analysis data for repoId: ${repoId} for user: ${req.user.id}`);

  const allowed = await canAccessRepo(repoId, req.user.id);
  const repo = allowed ? { id: repoId } : null;
  const fetchError = allowed ? null : new Error('not found');

  if (fetchError || !repo) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  try {
    const [
      { data: nodes, error: nodesErr },
      { data: edges, error: edgesErr },
      { data: issues, error: issuesErr }
    ] = await Promise.all([
      supabaseAdmin.from('graph_nodes').select('*').eq('repo_id', repoId),
      supabaseAdmin.from('graph_edges').select('*').eq('repo_id', repoId),
      supabaseAdmin.from('analysis_issues').select('*').eq('repo_id', repoId)
    ]);

    if (nodesErr) throw nodesErr;
    if (edgesErr) throw edgesErr;
    if (issuesErr) throw issuesErr;

    console.log(`[getAnalysisData] Found ${nodes.length} nodes, ${edges.length} edges, ${issues.length} issues for repo ${repoId}`);

    res.json({
      nodes: nodes || [],
      edges: edges || [],
      issues: issues || []
    });
  } catch (err) {
    console.error('[getAnalysisData] Error:', err);
    res.status(500).json({ error: 'Failed to fetch repository analysis data' });
  }
};

/**
 * PATCH /api/repos/:repoId — update mutable repo fields (auto_sync_enabled, sast_disabled_rules)
 */
const updateRepo = async (req, res) => {
  const { repoId } = req.params;
  const { auto_sync_enabled, sast_disabled_rules } = req.body;

  const updates = {};
  if (typeof auto_sync_enabled === 'boolean') updates.auto_sync_enabled = auto_sync_enabled;
  if (Array.isArray(sast_disabled_rules)) updates.sast_disabled_rules = sast_disabled_rules;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const { data, error } = await supabaseAdmin
    .from('repositories')
    .update(updates)
    .eq('id', repoId)
    .eq('user_id', req.user.id)
    .select()
    .single();

  if (error || !data) {
    console.error('[updateRepo]', error);
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  res.json({ ok: true, repo: data });
};

/**
 * GET /api/repos/:repoId/webhook — generate (or regenerate) a webhook secret.
 * Returns the secret exactly once — store it immediately as it cannot be retrieved again.
 */
const generateWebhook = async (req, res) => {
  const { repoId } = req.params;

  // Verify ownership
  const { data: repo, error: fetchError } = await supabaseAdmin
    .from('repositories')
    .select('id, source')
    .eq('id', repoId)
    .eq('user_id', req.user.id)
    .single();

  if (fetchError || !repo) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  if (repo.source !== 'github') {
    return res.status(400).json({ error: 'Webhooks are only supported for GitHub repositories' });
  }

  const secret = crypto.randomBytes(32).toString('hex');

  const { error: updateError } = await supabaseAdmin
    .from('repositories')
    .update({ webhook_secret: secret })
    .eq('id', repoId);

  if (updateError) {
    console.error('[generateWebhook]', updateError);
    return res.status(500).json({ error: 'Failed to save webhook secret' });
  }

  const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
  const webhookUrl = `${backendUrl}/api/webhooks/github`;

  res.json({ ok: true, webhookUrl, secret });
};

/**
 * GET /api/repos/:repoId/file?path=src/index.js
 * Returns concatenated source content from code_chunks for a given file.
 */
const getFileContent = async (req, res) => {
  const { repoId } = req.params;
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).json({ error: 'path query param is required' });
  }

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  // Fetch language from graph_nodes for the syntax highlighter
  const { data: node } = await supabaseAdmin
    .from('graph_nodes')
    .select('language')
    .eq('repo_id', repoId)
    .eq('file_path', filePath)
    .maybeSingle();

  // Concatenate chunks in line order
  const { data: chunks, error } = await supabaseAdmin
    .from('code_chunks')
    .select('content, start_line')
    .eq('repo_id', repoId)
    .eq('file_path', filePath)
    .order('start_line', { ascending: true });

  if (error) {
    console.error('[getFileContent]', error);
    return res.status(500).json({ error: 'Failed to fetch file content' });
  }

  if (!chunks || chunks.length === 0) {
    return res.status(404).json({ error: 'No indexed content for this file' });
  }

  res.json({
    content: chunks.map((c) => c.content).join(''),
    filePath,
    language: node?.language || null,
  });
};

module.exports = { connectRepo, uploadRepo, listRepos, getStatus, reindexRepo, deleteRepo, getAnalysisData, updateRepo, generateWebhook, getFileContent };
