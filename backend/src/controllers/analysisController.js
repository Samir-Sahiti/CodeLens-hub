/**
 * Analysis controller stubs
 * Full implementation across Sprints 2–3 (US-005 through US-007).
 */

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
  // TODO: Sprint 3 — query analysis_issues table
  res.status(501).json({ error: 'Not implemented' });
};

/** GET /api/analysis/:repoId/impact/:filePath — blast-radius BFS from a file */
const getImpact = async (req, res) => {
  // TODO: Sprint 4 — BFS/DFS over graph_edges to compute downstream dependents
  res.status(501).json({ error: 'Not implemented' });
};

module.exports = { getDependencyGraph, getMetrics, getIssues, getImpact };
