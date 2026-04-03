/**
 * Repository controller 
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
  indexer.startGitHubIndexing(repo.id, profile.github_access_token, name);

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
      .select('github_access_token')
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

/** GET /api/repos/:repoId/analysis — fetch nodes, edges, and issues in a single request */
const getAnalysisData = async (req, res) => {
  const { repoId } = req.params;
  console.log(`[getAnalysisData] Fetching analysis data for repoId: ${repoId} for user: ${req.user.id}`);
  
  const { data: repo, error: fetchError } = await supabaseAdmin
    .from('repositories')
    .select('id')
    .eq('id', repoId)
    .eq('user_id', req.user.id)
    .single();

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

module.exports = { connectRepo, uploadRepo, listRepos, getStatus, reindexRepo, deleteRepo, getAnalysisData };
