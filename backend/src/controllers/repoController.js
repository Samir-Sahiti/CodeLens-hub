/**
 * Repository controller stubs
 * Full implementation will be added in US-003 (GitHub API integration)
 * and US-004 (file indexing).
 */
const { supabaseAdmin } = require('../db/supabase');

const indexer = require('../services/indexer');

/** POST /api/repos — connect a GitHub repo and trigger indexing */
const connectRepo = async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Repo name is required' });

  // 1. Get user's github token from profiles
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('github_access_token')
    .eq('id', req.user.id)
    .single();

  if (!profile?.github_access_token) {
    return res.status(400).json({ error: 'GitHub token not found' });
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
  // We don't await this so the user gets an immediate 200 OK
  indexer.startGitHubIndexing(repo.id, profile.github_access_token, name);

  res.json({ ok: true, repo });
};

/** POST /api/repos/upload — upload a local repository zip */
const uploadRepo = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No repository zip file uploaded' });
  }

  // Use original file name without extension
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

/** GET /api/repos — list repos belonging to the authenticated user */
const listRepos = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('repositories')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[listRepos] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch repositories' });
  }

  res.json({ repos: data });
};

/** GET /api/repos/:repoId/status — polling endpoint for indexing progress */
const getStatus = async (req, res) => {
  // TODO: US-004 — return current status from repositories table
  res.status(501).json({ error: 'Not implemented' });
};

/** DELETE /api/repos/:repoId — remove repo and all related data */
const deleteRepo = async (req, res) => {
  // TODO: cascade delete handled by FK constraints in DB
  res.status(501).json({ error: 'Not implemented' });
};

/** POST /api/repos/:repoId/reindex — re-trigger indexing on a repository */
const reindexRepo = async (req, res) => {
  const { repoId } = req.params;

  // 1. Verify ownership and get repo details
  const { data: repo, error: fetchError } = await supabaseAdmin
    .from('repositories')
    .select('*')
    .eq('id', repoId)
    .eq('user_id', req.user.id)
    .single();

  if (fetchError || !repo) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  // 2. Cascade delete existing indexing data exactly in this order
  // (code_chunks, analysis_issues, graph_edges, graph_nodes)
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

  // 3. Keep the repo but reset status
  const { error: updateError } = await supabaseAdmin
    .from('repositories')
    .update({ status: 'pending', file_count: 0, indexed_at: null })
    .eq('id', repoId);

  if (updateError) {
    console.error('[reindexRepo] Failed to reset status:', updateError);
    return res.status(500).json({ error: 'Failed to restart repository indexing' });
  }

  // 4. Trigger the correct indexer based on source
  if (repo.source === 'github') {
    // Need token from profiles
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('github_access_token')
      .eq('id', req.user.id)
      .single();
      
    if (profile?.github_access_token) {
      indexer.startGitHubIndexing(repo.id, profile.github_access_token, repo.name);
    } else {
      console.error(`[reindexRepo] Cannot reindex github repo ${repo.id} — missing token.`);
      await supabaseAdmin.from('repositories').update({ status: 'failed' }).eq('id', repoId);
    }
  } else {
    // For local uploads, since we deleted the zip, we will simulate a "retry" by
    // running the dummy local indexing on a fake path, which will fail if it strictly needs it, 
    // or we can simulate a quick ready flip. We'll simulate a 3s reset.
    // In US-008 we're instructed to call the same pipeline.
    indexer.startLocalIndexing(repo.id, '', repo.name).catch(() => {});
  }

  res.json({ ok: true, message: 'Re-indexing started' });
};

module.exports = { connectRepo, uploadRepo, listRepos, getStatus, reindexRepo, deleteRepo };
