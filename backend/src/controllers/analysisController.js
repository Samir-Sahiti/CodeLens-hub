const { supabase, supabaseAdmin } = require('../db/supabase');

/** GET /api/analysis/:repoId/graph — dependency graph nodes + edges */
const getDependencyGraph = async (req, res) => {
  // TODO: Sprint 2 — query graph_nodes + graph_edges for req.params.repoId
  res.status(501).json({ error: 'Not implemented' });
};

/** GET /api/analysis/:repoId/metrics — per-file complexity metrics */
const getMetrics = async (req, res) => {
  // TODO: Sprint 3 — aggregate complexity_score, incoming_count, outgoing_count
  res.status(501).json({ error: 'Not implemented' });
};

/** GET /api/analysis/:repoId/issues — architectural issues (circular deps, god files, etc.) */
const getIssues = async (req, res) => {
  const { repoId } = req.params;
  const { data, error } = await supabaseAdmin
    .from('analysis_issues')
    .select('*')
    .eq('repo_id', repoId);
    
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
};

/** POST /api/analysis/:repoId/issues/suppress — mark an issue as a false positive */
const suppressIssue = async (req, res) => {
  const { repoId } = req.params;
  const { file_path, rule_id, line_number } = req.body;
  const userId = req.user.id;

  // 1. Insert into suppressions table
  const { error: suppError } = await supabase
    .from('issue_suppressions')
    .insert({ repo_id: repoId, file_path, rule_id, line_number, created_by: userId });

  if (suppError) return res.status(500).json({ error: suppError.message });

  // 2. Delete the active issue from analysis_issues so it disappears immediately
  await supabaseAdmin
    .from('analysis_issues')
    .delete()
    .match({ repo_id: repoId, type: 'hardcoded_secret' })
    .contains('file_paths', [file_path])
    .ilike('description', `%Rule ID: ${rule_id}%`);

  res.status(200).json({ success: true });
};

/** GET /api/analysis/:repoId/impact/:filePath — blast-radius BFS from a file */
const getImpact = async (req, res) => {
  // TODO: Sprint 4 — BFS/DFS over graph_edges to compute downstream dependents
  res.status(501).json({ error: 'Not implemented' });
};

module.exports = { getDependencyGraph, getMetrics, getIssues, suppressIssue, getImpact };
