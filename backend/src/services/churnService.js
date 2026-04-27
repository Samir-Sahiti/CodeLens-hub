// US-050: Git history hotspots
// Fetches last 12 months of commit metadata from the GitHub REST API and
// aggregates per-file churn stats, then writes them to the file_churn table.
// Best-effort: errors are logged and never block the indexing pipeline.

const { supabaseAdmin } = require('../db/supabase');
const pLimit = require('p-limit');

const GITHUB_API = 'https://api.github.com';
const COMMIT_PAGE_SIZE = 100;
const MAX_COMMITS = 500;       // Cap total commits analysed to bound API usage
const DETAIL_CONCURRENCY = 8;  // Concurrent commit-detail fetches

function sinceDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString();
}

async function githubGet(url, token) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'CodeLens-Hub/1.0',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Paginate all commits from the last 12 months (capped at MAX_COMMITS).
 */
async function listCommits(owner, repo, token) {
  const since = sinceDate();
  const commits = [];
  let page = 1;

  while (commits.length < MAX_COMMITS) {
    const url = `${GITHUB_API}/repos/${owner}/${repo}/commits?since=${since}&per_page=${COMMIT_PAGE_SIZE}&page=${page}`;
    const batch = await githubGet(url, token);
    if (!Array.isArray(batch) || batch.length === 0) break;
    commits.push(...batch);
    if (batch.length < COMMIT_PAGE_SIZE) break;
    page++;
  }

  return commits.slice(0, MAX_COMMITS);
}

/**
 * Fetch the file-level diff for a single commit SHA.
 * Returns array of { filename, additions, deletions, changes }.
 */
async function getCommitDetail(owner, repo, sha, token) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/commits/${sha}`;
  const data = await githubGet(url, token);
  return data.files || [];
}

/**
 * Aggregate commit list + file diffs into per-file churn stats.
 */
async function buildChurnMap(owner, repo, token, commits) {
  const limit = pLimit(DETAIL_CONCURRENCY);
  const churnMap = new Map(); // filePath → { commitShas, authors, linesChanged, lastModified }

  const results = await Promise.allSettled(
    commits.map(commit =>
      limit(async () => {
        const files = await getCommitDetail(owner, repo, commit.sha, token);
        return {
          sha: commit.sha,
          date: commit.commit?.author?.date || commit.commit?.committer?.date,
          author: commit.commit?.author?.email || commit.commit?.author?.name || 'unknown',
          files,
        };
      })
    )
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { date, author, files } = result.value;
    const ts = date ? new Date(date) : null;

    for (const file of files) {
      const fp = file.filename;
      if (!churnMap.has(fp)) {
        churnMap.set(fp, { count: 0, authors: new Set(), lines: 0, lastModified: null });
      }
      const entry = churnMap.get(fp);
      entry.count += 1;
      entry.authors.add(author);
      entry.lines += (file.additions || 0) + (file.deletions || 0);
      if (ts && (!entry.lastModified || ts > entry.lastModified)) {
        entry.lastModified = ts;
      }
    }
  }

  return churnMap;
}

/**
 * Main entry point. Fetches churn data for a GitHub repo and persists it.
 *
 * @param {string} owner
 * @param {string} repoName  - just the repo name (not owner/repo)
 * @param {string} token     - GitHub access token
 * @param {string} repoId    - internal DB UUID
 * @returns {Map<string, object>} churnMap (filePath → stats) for use by caller
 */
async function fetchRepoChurn(owner, repoName, token, repoId) {
  console.time(`[churn] Fetch (${repoId})`);

  const commits = await listCommits(owner, repoName, token);
  console.log(`[churn] Processing ${commits.length} commits for ${owner}/${repoName}`);

  if (commits.length === 0) {
    console.timeEnd(`[churn] Fetch (${repoId})`);
    return new Map();
  }

  const churnMap = await buildChurnMap(owner, repoName, token, commits);

  // Upsert into file_churn table
  const rows = [];
  for (const [filePath, entry] of churnMap.entries()) {
    rows.push({
      repo_id: repoId,
      file_path: filePath,
      commit_count: entry.count,
      unique_authors: entry.authors.size,
      lines_changed: entry.lines,
      last_modified: entry.lastModified ? entry.lastModified.toISOString() : null,
    });
  }

  if (rows.length > 0) {
    // Process in batches to avoid Supabase row limits
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabaseAdmin
        .from('file_churn')
        .upsert(rows.slice(i, i + BATCH), { onConflict: 'repo_id,file_path', ignoreDuplicates: false });
      if (error) console.warn(`[churn] DB upsert error: ${error.message}`);
    }
    console.log(`[churn] Wrote ${rows.length} file_churn rows for repo ${repoId}`);
  }

  console.timeEnd(`[churn] Fetch (${repoId})`);
  return churnMap;
}

module.exports = { fetchRepoChurn };
