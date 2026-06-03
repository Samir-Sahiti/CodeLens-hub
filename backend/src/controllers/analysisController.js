const { supabase, supabaseAdmin } = require('../db/supabase');
const { SAFE_FETCH_CEILING, warnIfCeilingHit } = require('../lib/dbHelpers');
const graphService = require('../services/graphService');
const { buildRiskContext, computeRiskComponents } = require('../services/riskScoring');

async function attachRiskComponents(repoId, issues) {
  const ctx = await buildRiskContext(repoId);
  return (issues || []).map((issue) => {
    const components = computeRiskComponents(issue, ctx);
    return {
      ...issue,
      ...components,
      risk_score: issue.risk_score == null ? components.risk_score : issue.risk_score,
    };
  });
}

/** GET /api/analysis/:repoId/graph — dependency graph overview (counts + top hubs/sinks + cycle count) */
const getDependencyGraph = async (req, res) => {
  try {
    const overview = await graphService.getGraphOverview(req.params.repoId);
    res.json(overview);
  } catch (err) {
    console.error('[getDependencyGraph]', err);
    res.status(500).json({ error: 'Failed to fetch graph overview' });
  }
};

/** GET /api/analysis/:repoId/metrics — per-file complexity metrics */
const getMetrics = async (req, res) => {
  const { repoId } = req.params;
  const { data, error } = await supabaseAdmin
    .from('graph_nodes')
    .select('file_path, language, line_count, complexity_score, incoming_count, outgoing_count, node_classification, is_test_file')
    .eq('repo_id', repoId)
    .range(0, SAFE_FETCH_CEILING - 1);
  if (error) return res.status(500).json({ error: error.message });
  warnIfCeilingHit('analysisController.getMetrics', data);
  res.json(data);
};

/** GET /api/analysis/:repoId/issues — architectural issues (circular deps, god files, etc.) */
const getIssues = async (req, res) => {
  const { repoId } = req.params;
  const { data, error } = await supabaseAdmin
    .from('analysis_issues')
    .select('*')
    .eq('repo_id', repoId)
    .range(0, SAFE_FETCH_CEILING - 1);

  if (error) return res.status(500).json({ error: error.message });
  warnIfCeilingHit('analysisController.getIssues', data);
  res.json(await attachRiskComponents(repoId, data || []));
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

  // Derive issue type from rule_id so the delete targets the correct row
  const issueType = rule_id === 'missing_auth' ? 'missing_auth' : 'hardcoded_secret';

  // 2. Delete the active issue from analysis_issues so it disappears immediately
  await supabaseAdmin
    .from('analysis_issues')
    .delete()
    .match({ repo_id: repoId, type: issueType })
    .contains('file_paths', [file_path])
    .ilike('description', `%Rule ID: ${rule_id}%`);

  res.status(200).json({ success: true });
};

/** GET /api/analysis/:repoId/impact/:filePath — blast-radius BFS from a file */
const getImpact = async (req, res) => {
  try {
    const { repoId, filePath } = req.params;
    const result = await graphService.getBlastRadius(repoId, filePath);
    res.json(result);
  } catch (err) {
    console.error('[getImpact]', err);
    res.status(500).json({ error: 'Failed to compute blast radius' });
  }
};

module.exports = { getDependencyGraph, getMetrics, getIssues, suppressIssue, getImpact };
