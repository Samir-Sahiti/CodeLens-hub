/**
 * Repository controller
 */
const crypto = require('crypto');
const path = require('path');
const { Octokit } = require('octokit');
const { supabaseAdmin } = require('../db/supabase');
const _indexer = require('../services/indexer');
const { isManifestFile, parseManifest } = require('../services/manifestParser');
const { scanDependencies } = require('../services/osvScanner');
const { buildDuplicationClusters } = require('../services/duplicationScanner');
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

  // Enrich repos with language distribution for dashboard cards
  const repoIds = repos.map((r) => r.id);
  if (repoIds.length > 0) {
    const { data: langRows } = await supabaseAdmin
      .from('graph_nodes')
      .select('repo_id, language')
      .in('repo_id', repoIds)
      .limit(10000);

    if (langRows && langRows.length > 0) {
      const langByRepo = {};
      langRows.forEach(({ repo_id, language }) => {
        if (!langByRepo[repo_id]) langByRepo[repo_id] = {};
        const lang = language || 'unknown';
        langByRepo[repo_id][lang] = (langByRepo[repo_id][lang] || 0) + 1;
      });
      repos.forEach((r) => {
        r.languages = Object.entries(langByRepo[r.id] || {})
          .map(([language, count]) => ({ language, count }))
          .sort((a, b) => b.count - a.count);
      });
    }
  }

  res.json({ repos });
};

/** GET /api/repos/:repoId/status — polling endpoint for indexing progress */
const getStatus = async (req, res) => {
  const { repoId } = req.params;
  const { data, error } = await supabaseAdmin
    .from('repositories')
    .select('status, file_count, sast_disabled_rules')
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

const reindexRepo = async (req, res) => {
  const { repoId } = req.params;

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  const { data: repo, error: fetchError } = await supabaseAdmin
    .from('repositories')
    .select('*')
    .eq('id', repoId)
    .single();

  if (fetchError || !repo) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  // Guard against concurrent indexing runs — two pipelines writing to the same
  // repo's tables at once is a known path to inconsistent graphs.  Status
  // 'indexing' means the worker is actively running; 'pending' is brief and
  // covered by the frontend click debounce.
  if (repo.status === 'indexing') {
    return res.status(409).json({ error: 'Indexing already in progress. If it looks stuck, delete the repo and add it again.' });
  }

  // The derived tables are cleared asynchronously in the background by indexerService.js

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

    let githubToken = null;
    if (profile?.github_token_secret_id) {
      const { data: tokenData, error: tokenError } = await supabaseAdmin.rpc('get_github_token_secret', { secret_id: profile.github_token_secret_id });
      if (!tokenError && tokenData) {
        githubToken = tokenData;
      }
    }

    if (githubToken) {
      // Use full_name (owner/repo) so the GitHub API call resolves correctly.
      // Fall back to name for repos connected before full_name was populated.
      const repoFullName = repo.full_name || repo.name;
      indexer.startGitHubIndexing(repo.id, githubToken, repoFullName);
    } else {
      console.error(`[reindexRepo] GitHub token not found in vault for user ${req.user.id} — profile.github_token_secret_id: ${profile?.github_token_secret_id ?? 'null'}. User must sign out and sign back in to re-sync their token.`);
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
      supabaseAdmin.from('graph_nodes').select('*').eq('repo_id', repoId).order('file_path', { ascending: true }),
      supabaseAdmin.from('graph_edges').select('*').eq('repo_id', repoId).order('from_path', { ascending: true }).order('to_path', { ascending: true }),
      supabaseAdmin.from('analysis_issues').select('*').eq('repo_id', repoId).order('id', { ascending: true })
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
 * Returns full file content from file_contents (US-043), falling back to
 * concatenated code_chunks for repos indexed before US-043 was deployed.
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

  // Primary: full content from file_contents (US-043)
  const { data: fc, error: fcErr } = await supabaseAdmin
    .from('file_contents')
    .select('content')
    .eq('repo_id', repoId)
    .eq('file_path', filePath)
    .maybeSingle();

  if (!fcErr && fc) {
    return res.json({ content: fc.content, filePath, language: node?.language || null });
  }

  // Fallback: concatenate code_chunks (pre-US-043 repos)
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


/** GET /api/repos/:repoId/dependencies — fetch parsed dependency manifest data for the Dependencies tab */
const getDependencies = async (req, res) => {
  const { repoId } = req.params;

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) {
    return res.status(404).json({ error: 'Repository not found or unauthorized' });
  }

  try {
    const { data: repo, error: repoError } = await supabaseAdmin
      .from('repositories')
      .select('id, name, full_name, source')
      .eq('id', repoId)
      .single();

    if (repoError || !repo) {
      return res.status(404).json({ error: 'Repository not found or unauthorized' });
    }

    // Always serve from the indexed dependency_manifests table — data is stored during
    // indexing (indexerService SCA phase). The previous live-GitHub-fetch path re-ran
    // OSV scanning on every request, causing 5-20 s tab load times with no benefit
    // (the data is already fresh from the last index run).
    const dependencies = await getStoredDependenciesWithIssues(repoId);
    res.json({ dependencies });
  } catch (err) {
    console.error('[getDependencies] Error:', err);
    res.status(500).json({ error: 'Failed to fetch dependency data' });
  }
};

async function _getGithubTokenForUser(userId) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('github_token_secret_id')
    .eq('id', userId)
    .single();

  if (!profile?.github_token_secret_id) return null;

  const { data: tokenData, error: tokenError } = await supabaseAdmin
    .rpc('get_github_token_secret', { secret_id: profile.github_token_secret_id });

  if (tokenError || !tokenData) return null;
  return tokenData;
}

async function _fetchLiveGitHubDependencies({ repoId, repoFullName, githubToken }) {
  const [owner, repo] = String(repoFullName || '').split('/');
  if (!owner || !repo) {
    throw new Error('Repository full name is missing or invalid');
  }

  const octokit = new Octokit({ auth: githubToken });
  const { data: commit } = await octokit.rest.repos.getCommit({
    owner,
    repo,
    ref: 'HEAD',
  });
  const { data: treeRef } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: commit.commit.tree.sha,
    recursive: '1',
  });

  const manifestEntries = (treeRef.tree || []).filter((item) => (
    item.type === 'blob' &&
    item.path &&
    !item.path.includes('node_modules/') &&
    !item.path.includes('.git/') &&
    isManifestFile(item.path)
  ));

  const parsedDeps = [];
  for (const entry of manifestEntries) {
    try {
      const { data: blob } = await octokit.rest.git.getBlob({
        owner,
        repo,
        file_sha: entry.sha,
      });
      const content = Buffer.from(blob.content, blob.encoding).toString('utf-8');
      parsedDeps.push(...parseManifest(entry.path, content));
    } catch (err) {
      console.warn(`[getDependencies] Failed to fetch/parse manifest ${entry.path}: ${err.message}`);
    }
  }

  if (parsedDeps.length === 0) {
    return [];
  }

  const { depResults } = await scanDependencies(parsedDeps, repoId);
  return depResults
    .map((row) => ({
      ...row,
      version: row.version,
    }))
    .sort((a, b) => {
      if ((b.vuln_count || 0) !== (a.vuln_count || 0)) {
        return (b.vuln_count || 0) - (a.vuln_count || 0);
      }
      return String(a.package_name || '').localeCompare(String(b.package_name || ''));
    });
}

async function getStoredDependenciesWithIssues(repoId) {
  const [
    { data: dependencyRows, error: dependencyError },
    { data: issueRows, error: issuesError },
  ] = await Promise.all([
    (async () => {
      const PAGE = 1000;
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseAdmin
          .from('dependency_manifests')
          .select('*')
          .eq('repo_id', repoId)
          .order('vuln_count', { ascending: false })
          .range(from, from + PAGE - 1);
        // PGRST103 = 416 Range Not Satisfiable — offset is past the last row, we're done
        if (error) {
          if (error.code === 'PGRST103') return { data: rows, error: null };
          return { data: null, error };
        }
        rows.push(...(data || []));
        if (!data || data.length < PAGE) return { data: rows, error: null };
      }
    })(),
    supabaseAdmin
      .from('analysis_issues')
      .select('severity, description, file_paths')
      .eq('repo_id', repoId)
      .eq('type', 'vulnerable_dependency'),
  ]);

  if (dependencyError) throw dependencyError;
  if (issuesError) throw issuesError;

  const issueGroups = new Map();
  for (const issue of issueRows || []) {
    const parsed = parseDependencyIssue(issue);
    if (!parsed) continue;

    const groupKey = makeIssueGroupKey(parsed.manifestPath, parsed.package_name, parsed.pkg_version);
    const existing = issueGroups.get(groupKey) || {
      manifest_path: parsed.manifestPath,
      ecosystem: inferEcosystemFromManifest(parsed.manifestPath),
      package_name: parsed.package_name,
      pkg_version: parsed.pkg_version,
      is_transitive: false,
      vuln_count: 0,
      vulns_json: [],
    };

    existing.vuln_count += 1;
    existing.vulns_json.push({
      id: parsed.id,
      aliases: parsed.aliases,
      severity: parsed.severity,
      summary: parsed.summary,
      advisoryUrl: parsed.advisoryUrl,
      fixedVersion: parsed.fixedVersion,
    });
    issueGroups.set(groupKey, existing);
  }

  const dependencies = (dependencyRows || []).map((row) => {
    const merged = { ...row };
    const groupKey = makeIssueGroupKey(row.manifest_path, row.package_name, row.pkg_version);
    const matchingIssueGroup = issueGroups.get(groupKey);

    if (matchingIssueGroup) {
      merged.vuln_count = matchingIssueGroup.vuln_count;
      merged.vulns_json = matchingIssueGroup.vulns_json;
      issueGroups.delete(groupKey);
    }

    return {
      ...merged,
      version: merged.pkg_version,
    };
  });

  for (const backfilled of issueGroups.values()) {
    dependencies.push({
      ...backfilled,
      version: backfilled.pkg_version,
      issue_backfilled: true,
    });
  }

  dependencies.sort((a, b) => {
    if ((b.vuln_count || 0) !== (a.vuln_count || 0)) {
      return (b.vuln_count || 0) - (a.vuln_count || 0);
    }
    return String(a.package_name || '').localeCompare(String(b.package_name || ''));
  });

  return dependencies;
}

function parseDependencyIssue(issue) {
  const description = issue?.description || '';
  const vulnMarker = ' has a known vulnerability (';
  const prefixEnd = description.indexOf(vulnMarker);
  if (prefixEnd === -1) return null;

  const prefix = description.slice(0, prefixEnd);
  const colonIndex = prefix.indexOf(': ');
  if (colonIndex === -1) return null;

  const packageAndVersion = prefix.slice(colonIndex + 2).trim();
  const versionAtIndex = packageAndVersion.lastIndexOf('@');
  if (versionAtIndex <= 0) return null;

  const advisoryMatch = description.match(/Advisory:\s(https?:\/\/\S+)/);
  const fixedVersionMatch = description.match(/— upgrade to ([^.\s]+)/);

  const vulnBody = description.slice(prefixEnd + vulnMarker.length);
  const summaryEnd = advisoryMatch
    ? description.indexOf('. Advisory:')
    : vulnBody.indexOf(')');

  const rawSummary = summaryEnd >= 0
    ? description.slice(prefixEnd + vulnMarker.length, summaryEnd)
    : vulnBody.replace(/\)$/, '');

  const idPart = prefix.slice(0, colonIndex).trim();

  return {
    id: idPart,
    aliases: idPart.startsWith('CVE-') ? [idPart] : [],
    package_name: packageAndVersion.slice(0, versionAtIndex),
    pkg_version: packageAndVersion.slice(versionAtIndex + 1),
    summary: rawSummary.replace(/\)\s*$/, '').trim(),
    severity: issue?.severity || 'medium',
    advisoryUrl: advisoryMatch?.[1] || '',
    fixedVersion: fixedVersionMatch?.[1] || null,
    manifestPath: Array.isArray(issue?.file_paths) ? issue.file_paths[0] || '' : '',
  };
}

function makeIssueGroupKey(manifestPath, packageName, version) {
  return `${path.posix.dirname(manifestPath || '')}::${packageName || ''}::${version || ''}`;
}

function inferEcosystemFromManifest(manifestPath = '') {
  const lower = manifestPath.toLowerCase();
  if (lower.endsWith('package.json') || lower.endsWith('package-lock.json') || lower.endsWith('npm-shrinkwrap.json') || lower.endsWith('yarn.lock') || lower.endsWith('pnpm-lock.yaml')) {
    return 'npm';
  }
  if (lower.endsWith('requirements.txt') || lower.endsWith('poetry.lock') || lower.endsWith('pipfile.lock') || lower.endsWith('pyproject.toml')) {
    return 'PyPI';
  }
  if (lower.endsWith('go.mod') || lower.endsWith('go.sum')) {
    return 'Go';
  }
  if (lower.endsWith('cargo.toml') || lower.endsWith('cargo.lock')) {
    return 'crates.io';
  }
  if (lower.endsWith('gemfile') || lower.endsWith('gemfile.lock')) {
    return 'RubyGems';
  }
  if (lower.endsWith('.csproj') || lower.endsWith('packages.config')) {
    return 'NuGet';
  }
  return 'unknown';
}

/** GET /api/repos/:repoId/churn — file churn data for the hotspot overlay (US-050) */
const getChurn = async (req, res) => {
  const { repoId } = req.params;
  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  try {
    const [
      { data: churnRows, error: churnErr },
      { data: nodeRows,  error: nodeErr  },
    ] = await Promise.all([
      supabaseAdmin.from('file_churn').select('file_path,commit_count,unique_authors,lines_changed,last_modified').eq('repo_id', repoId),
      supabaseAdmin.from('graph_nodes').select('file_path,complexity_score').eq('repo_id', repoId),
    ]);

    if (churnErr) throw churnErr;
    if (nodeErr)  throw nodeErr;

    if (!churnRows || churnRows.length === 0) {
      return res.json({ churn: [] });
    }

    const complexityMap = new Map((nodeRows || []).map(n => [n.file_path, n.complexity_score || 0]));
    const maxCount      = Math.max(1, ...churnRows.map(r => r.commit_count));
    const maxComplexity = Math.max(1, ...[...complexityMap.values()]);

    const churn = churnRows.map(row => {
      const complexity   = complexityMap.get(row.file_path) || 0;
      const hotspotScore = (row.commit_count / maxCount) * (complexity / maxComplexity);
      return {
        file_path:      row.file_path,
        commit_count:   row.commit_count,
        unique_authors: row.unique_authors,
        lines_changed:  row.lines_changed,
        last_modified:  row.last_modified,
        complexity_score: complexity,
        hotspot_score:  hotspotScore,
      };
    });

    res.json({ churn });
  } catch (err) {
    console.error('[getChurn] Error:', err);
    res.status(500).json({ error: 'Failed to fetch churn data' });
  }
};

/** GET /api/repos/:repoId/duplication — duplicate code clusters (US-052) */
const getDuplication = async (req, res) => {
  const { repoId } = req.params;
  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  try {
    const clusters = await buildDuplicationClusters(repoId);
    res.json({ clusters });
  } catch (err) {
    console.error('[getDuplication] Error:', err);
    res.status(500).json({ error: 'Failed to fetch duplication clusters' });
  }
};

/**
 * GET /api/repos/:repoId/branches
 * Returns up to 100 branch names for the repo (US-051 branch picker).
 */
const getBranches = async (req, res) => {
  const { repoId } = req.params;

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const { data: repo } = await supabaseAdmin
    .from('repositories')
    .select('full_name, name, source, default_branch')
    .eq('id', repoId)
    .single();

  if (!repo || repo.source !== 'github') {
    return res.json({ branches: [], default_branch: 'main' });
  }

  const fullName = repo.full_name || repo.name || '';
  const [owner, repoName] = fullName.split('/');
  if (!owner || !repoName) return res.json({ branches: [], default_branch: repo.default_branch || 'main' });

  const githubToken = await _getGithubTokenForUser(req.user.id);
  if (!githubToken) return res.json({ branches: [], default_branch: repo.default_branch || 'main' });

  try {
    const octokit = new Octokit({ auth: githubToken });
    const { data } = await octokit.rest.repos.listBranches({
      owner,
      repo: repoName,
      per_page: 100,
    });

    const defaultBranch = repo.default_branch || 'main';
    const names = (data || []).map((b) => b.name);

    // Sort: default branch first, then alphabetically
    names.sort((a, b) => {
      if (a === defaultBranch) return -1;
      if (b === defaultBranch) return 1;
      return a.localeCompare(b);
    });

    res.json({ branches: names, default_branch: defaultBranch });
  } catch (err) {
    console.warn('[getBranches]', err.message);
    res.json({ branches: [], default_branch: repo.default_branch || 'main' });
  }
};

/**
 * GET /api/repos/:repoId/diff?base=<ref>&head=<ref>
 * Computes or returns a cached architectural diff between two git refs (US-051).
 * Only supported for GitHub-sourced repositories.
 */
const getDiff = async (req, res) => {
  const { repoId } = req.params;
  const { base, head } = req.query;

  if (!base || !head) {
    return res.status(400).json({ error: 'base and head query params are required' });
  }

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const { data: repo, error: repoError } = await supabaseAdmin
    .from('repositories')
    .select('id, name, full_name, source, default_branch')
    .eq('id', repoId)
    .single();

  if (repoError || !repo) return res.status(404).json({ error: 'Repository not found' });
  if (repo.source !== 'github') {
    return res.status(400).json({ error: 'Architectural diff is only supported for GitHub repositories' });
  }

  const fullName = repo.full_name || repo.name || '';
  const [owner, repoName] = fullName.split('/');
  if (!owner || !repoName) {
    return res.status(400).json({ error: 'Repository full_name is missing or invalid' });
  }

  const githubToken = await _getGithubTokenForUser(req.user.id);
  if (!githubToken) return res.status(400).json({ error: 'GitHub token not found' });

  try {
    const octokit = new Octokit({ auth: githubToken });

    // Resolve refs to commit SHAs so we can key the cache on stable SHAs
    const [baseResult, headResult] = await Promise.allSettled([
      octokit.rest.repos.getCommit({ owner, repo: repoName, ref: base }),
      octokit.rest.repos.getCommit({ owner, repo: repoName, ref: head }),
    ]);

    if (baseResult.status === 'rejected') {
      return res.status(400).json({ error: `Could not resolve base ref "${base}": ${baseResult.reason?.message}` });
    }
    if (headResult.status === 'rejected') {
      return res.status(400).json({ error: `Could not resolve head ref "${head}": ${headResult.reason?.message}` });
    }

    const baseSha = baseResult.value.data.sha;
    const headSha = headResult.value.data.sha;
    const baseTreeSha = baseResult.value.data.commit.tree.sha;
    const headTreeSha = headResult.value.data.commit.tree.sha;

    // Cache lookup by stable SHAs
    const { data: cached } = await supabaseAdmin
      .from('diff_cache')
      .select('result_json')
      .eq('repo_id', repoId)
      .eq('base_sha', baseSha)
      .eq('head_sha', headSha)
      .maybeSingle();

    if (cached?.result_json) {
      return res.json(cached.result_json);
    }

    const { computeArchDiff } = require('../services/diffService');
    const diff = await computeArchDiff({
      owner,
      name: repoName,
      token: githubToken,
      baseRef: base,
      headRef: head,
      baseCommit: { sha: baseSha, treeSha: baseTreeSha },
      headCommit: { sha: headSha, treeSha: headTreeSha },
    });

    // Persist to cache (best-effort; failure must not break the response)
    supabaseAdmin
      .from('diff_cache')
      .upsert({
        repo_id: repoId,
        base_sha: baseSha,
        head_sha: headSha,
        base_ref: base,
        head_ref: head,
        result_json: diff,
      }, { onConflict: 'repo_id,base_sha,head_sha' })
      .then(({ error }) => {
        if (error) console.warn('[getDiff] Cache write failed:', error.message);
      });

    res.json(diff);
  } catch (err) {
    console.error('[getDiff] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to compute architectural diff' });
  }
};

module.exports = { connectRepo, uploadRepo, listRepos, getStatus, reindexRepo, deleteRepo, getAnalysisData, updateRepo, generateWebhook, getFileContent, getDependencies, getChurn, getDuplication, getBranches, getDiff };
