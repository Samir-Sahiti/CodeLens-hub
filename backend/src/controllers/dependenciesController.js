/**
 * Dependencies controller — US-045
 *
 * GET /api/repos/:repoId/dependencies
 *   Returns a per-manifest dependency report including vuln counts.
 *   Data is derived from analysis_issues (type='vulnerable_dependency')
 *   stored during indexing — no live OSV call at request time.
 */
const { supabaseAdmin } = require('../db/supabase');

/**
 * Checks access: owner OR team member.
 */
async function canAccessRepo(repoId, userId) {
  const { data: owned } = await supabaseAdmin
    .from('repositories')
    .select('id')
    .eq('id', repoId)
    .eq('user_id', userId)
    .maybeSingle();
  if (owned) return true;

  const { data: memberships } = await supabaseAdmin
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId);
  const teamIds = (memberships || []).map(m => m.team_id);
  if (!teamIds.length) return false;

  const { data: teamRepo } = await supabaseAdmin
    .from('team_repositories')
    .select('repo_id')
    .eq('repo_id', repoId)
    .in('team_id', teamIds)
    .maybeSingle();
  return !!teamRepo;
}

/**
 * GET /api/repos/:repoId/dependencies
 *
 * Returns:
 * {
 *   manifests: Array<{
 *     path: string,
 *     ecosystem: string,
 *     totalDeps: number,
 *     vulnCount: number,
 *     hasLockfile: boolean
 *   }>,
 *   vulnIssues: Array<analysis_issues row>   -- type='vulnerable_dependency'
 * }
 */
const getDependencies = async (req, res) => {
  const { repoId } = req.params;

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  // Pull all vuln issues for this repo from the stored analysis
  const { data: vulnIssues, error: issuesErr } = await supabaseAdmin
    .from('analysis_issues')
    .select('*')
    .eq('repo_id', repoId)
    .eq('type', 'vulnerable_dependency');

  if (issuesErr) {
    console.error('[getDependencies]', issuesErr);
    return res.status(500).json({ error: 'Failed to fetch vulnerability data' });
  }

  // Build a manifest-level summary from the issue file_paths
  const manifestMap = new Map();
  for (const issue of (vulnIssues || [])) {
    const manifestPath = (issue.file_paths || [])[0];
    if (!manifestPath) continue;

    if (!manifestMap.has(manifestPath)) {
      // Derive ecosystem from manifest filename
      const base = manifestPath.split('/').pop().toLowerCase();
      let ecosystem = 'unknown';
      if (base === 'package.json' || base === 'package-lock.json' || base === 'yarn.lock') ecosystem = 'npm';
      else if (base === 'requirements.txt' || base === 'pipfile.lock') ecosystem = 'PyPI';
      else if (base === 'go.mod') ecosystem = 'Go';
      else if (base === 'cargo.lock') ecosystem = 'crates.io';
      else if (base === 'gemfile.lock') ecosystem = 'RubyGems';
      else if (base.endsWith('.csproj')) ecosystem = 'NuGet';

      manifestMap.set(manifestPath, { path: manifestPath, ecosystem, vulnCount: 0, highCount: 0, mediumCount: 0, lowCount: 0 });
    }
    const entry = manifestMap.get(manifestPath);
    entry.vulnCount++;
    if (issue.severity === 'high')   entry.highCount++;
    if (issue.severity === 'medium') entry.mediumCount++;
    if (issue.severity === 'low')    entry.lowCount++;
  }

  // We don't have graph_nodes rows for manifest-only files (they have no AST edges),
  // so we surface vuln-positive manifests from stored issues. Clean manifests
  // (no vuln issues) would require storing manifest metadata during indexing.

  const manifests = Array.from(manifestMap.values());

  res.json({
    manifests,
    vulnIssues: vulnIssues || [],
    totalVulns: (vulnIssues || []).length,
  });
};

module.exports = { getDependencies };
