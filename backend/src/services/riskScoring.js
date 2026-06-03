const { supabaseAdmin } = require('../db/supabase');

const SEVERITY_WEIGHT = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function severityWeight(severity) {
  return SEVERITY_WEIGHT[String(severity || '').toLowerCase()] || 1;
}

function buildReverseAdjacency(edges = []) {
  const reverse = new Map();
  for (const edge of edges || []) {
    if (!edge?.from_path || !edge?.to_path) continue;
    if (!reverse.has(edge.to_path)) reverse.set(edge.to_path, []);
    reverse.get(edge.to_path).push(edge.from_path);
  }
  return reverse;
}

function transitiveDependentsCount(reverse, filePath) {
  if (!filePath) return 0;
  const visited = new Set([filePath]);
  const queue = [];
  let head = 0;

  for (const importer of reverse.get(filePath) || []) {
    if (visited.has(importer)) continue;
    visited.add(importer);
    queue.push({ path: importer, depth: 1 });
  }

  let transitive = 0;
  while (head < queue.length) {
    const { path, depth } = queue[head++];
    if (depth >= 2) transitive += 1;
    for (const importer of reverse.get(path) || []) {
      if (visited.has(importer)) continue;
      visited.add(importer);
      queue.push({ path: importer, depth: depth + 1 });
    }
  }

  return transitive;
}

function median(values = []) {
  const sorted = values
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function loadChurnMetrics(repoId) {
  const { data, error } = await supabaseAdmin
    .from('churn_metrics')
    .select('file_path, commits_in_last_30d')
    .eq('repo_id', repoId);

  if (error) {
    console.warn(`[risk] churn_metrics unavailable for ${repoId}: ${error.message}`);
    return { byPath: new Map(), medianCommits30d: 0 };
  }

  const byPath = new Map();
  for (const row of data || []) {
    byPath.set(row.file_path, Number(row.commits_in_last_30d || 0));
  }
  return {
    byPath,
    medianCommits30d: median([...byPath.values()]),
  };
}

function firstIssuePath(issue = {}) {
  return Array.isArray(issue.file_paths) ? issue.file_paths[0] : issue.file_path || '';
}

function computeRiskComponents(issue, { reverse, churnByPath, medianCommits30d }) {
  const filePath = firstIssuePath(issue);
  const transitiveCount = transitiveDependentsCount(reverse, filePath);
  const commits30d = churnByPath.get(filePath);
  const severity_weight = severityWeight(issue.severity);
  const blast_factor = Math.min(3, 1 + Math.log10(1 + transitiveCount));
  const churn_factor = commits30d == null || !medianCommits30d
    ? 1
    : Math.min(2, 1 + (commits30d / medianCommits30d));
  const risk_score = severity_weight * blast_factor * churn_factor;
  return {
    risk_score: Number(risk_score.toFixed(2)),
    severity_weight,
    blast_factor: Number(blast_factor.toFixed(2)),
    churn_factor: Number(churn_factor.toFixed(2)),
  };
}

async function buildRiskContext(repoId, edges = null) {
  let edgeRows = edges;
  if (!edgeRows) {
    const { data, error } = await supabaseAdmin
      .from('graph_edges')
      .select('from_path, to_path')
      .eq('repo_id', repoId);
    if (error) {
      console.warn(`[risk] graph_edges unavailable for ${repoId}: ${error.message}`);
      edgeRows = [];
    } else {
      edgeRows = data || [];
    }
  }
  const churn = await loadChurnMetrics(repoId);
  return {
    reverse: buildReverseAdjacency(edgeRows),
    churnByPath: churn.byPath,
    medianCommits30d: churn.medianCommits30d,
  };
}

async function scoreIssuesForRepo(repoId, issues = [], edges = null) {
  const ctx = await buildRiskContext(repoId, edges);
  return (issues || []).map((issue) => ({
    ...issue,
    ...computeRiskComponents(issue, ctx),
  }));
}

module.exports = {
  SEVERITY_WEIGHT,
  buildReverseAdjacency,
  buildRiskContext,
  computeRiskComponents,
  scoreIssuesForRepo,
  severityWeight,
};
