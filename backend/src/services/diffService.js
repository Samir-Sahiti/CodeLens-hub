/**
 * diffService.js — US-051: Architectural diff between branches or commits.
 *
 * Computes a structural diff (nodes, edges, new issues) between two git refs
 * without touching the primary index tables.
 */

const path = require('path');
const { Octokit } = require('octokit');
const { parseFile } = require('../parsers/repositoryParser');
const pLimit = require('p-limit');

const VALID_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.cs', '.go', '.java', '.rs', '.rb']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'vendor', '__pycache__', 'dist', 'build', '.next', 'coverage', '.cache']);

function getLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.js', '.jsx'].includes(ext)) return 'javascript';
  if (['.ts', '.tsx'].includes(ext)) return 'typescript';
  if (ext === '.py') return 'python';
  if (ext === '.cs') return 'c_sharp';
  if (ext === '.go') return 'go';
  if (ext === '.java') return 'java';
  if (ext === '.rs') return 'rust';
  if (ext === '.rb') return 'ruby';
  return 'unknown';
}

function shouldSkipPath(filePath) {
  return filePath.split('/').some((part) => SKIP_DIRS.has(part));
}

async function resolveRefToCommit(octokit, owner, repo, ref) {
  try {
    const { data } = await octokit.rest.repos.getCommit({ owner, repo, ref });
    return { sha: data.sha, treeSha: data.commit.tree.sha };
  } catch (err) {
    throw new Error(`Could not resolve ref "${ref}": ${err.message}`);
  }
}

async function fetchCodeTree(octokit, owner, repo, treeSha) {
  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: '1',
  });

  const files = new Map();
  for (const item of data.tree || []) {
    if (item.type !== 'blob') continue;
    const ext = path.extname(item.path).toLowerCase();
    if (!VALID_EXTENSIONS.has(ext)) continue;
    if (shouldSkipPath(item.path)) continue;
    files.set(item.path, { sha: item.sha, size: item.size || 0 });
  }
  return files;
}

async function fetchBlob(octokit, owner, repo, sha) {
  const { data } = await octokit.rest.git.getBlob({ owner, repo, file_sha: sha });
  return Buffer.from(data.content, data.encoding).toString('utf-8');
}

/**
 * Compute a structural architectural diff between two git refs.
 *
 * @param {Object} params
 * @param {string} params.owner   - GitHub owner (login)
 * @param {string} params.name    - GitHub repo name
 * @param {string} params.token   - GitHub access token
 * @param {string} params.baseRef - Base ref (branch name, tag, or SHA)
 * @param {string} params.headRef - Head ref (branch name, tag, or SHA)
 * @param {{ sha: string, treeSha: string }} [params.baseCommit] - Pre-resolved base commit (skip resolution)
 * @param {{ sha: string, treeSha: string }} [params.headCommit] - Pre-resolved head commit
 * @returns {Promise<Object>} Structured diff payload
 */
async function computeArchDiff({ owner, name, token, baseRef, headRef, baseCommit: preBase, headCommit: preHead }) {
  const octokit = new Octokit({ auth: token });

  const [baseCommit, headCommit] = preBase && preHead
    ? [preBase, preHead]
    : await Promise.all([
        resolveRefToCommit(octokit, owner, name, baseRef),
        resolveRefToCommit(octokit, owner, name, headRef),
      ]);

  if (baseCommit.sha === headCommit.sha) {
    return {
      base_ref: baseRef,
      head_ref: headRef,
      base_sha: baseCommit.sha,
      head_sha: headCommit.sha,
      identical: true,
      summary: {
        added_files: 0,
        removed_files: 0,
        modified_files: 0,
        unchanged_files: 0,
        added_edges: 0,
        removed_edges: 0,
        new_issues: [],
        complexity_deltas: [],
      },
      nodes: [],
      edges: { added: [], removed: [] },
    };
  }

  const [baseFiles, headFiles] = await Promise.all([
    fetchCodeTree(octokit, owner, name, baseCommit.treeSha),
    fetchCodeTree(octokit, owner, name, headCommit.treeSha),
  ]);

  // Classify each file by diff status
  const addedPaths = [];
  const removedPaths = [];
  const modifiedPaths = [];
  const unchangedPaths = [];

  const allPaths = new Set([...baseFiles.keys(), ...headFiles.keys()]);
  for (const p of allPaths) {
    const inBase = baseFiles.has(p);
    const inHead = headFiles.has(p);
    if (inBase && !inHead) {
      removedPaths.push(p);
    } else if (!inBase && inHead) {
      addedPaths.push(p);
    } else if (baseFiles.get(p).sha !== headFiles.get(p).sha) {
      modifiedPaths.push(p);
    } else {
      unchangedPaths.push(p);
    }
  }

  // Fetch content only for changed files, capped to avoid timeout on huge diffs.
  // modifiedPaths must appear in both lists — apply a shared budget so removed files
  // are not crowded out when there are many modified ones.
  const MAX_BLOBS = 300;
  const changedInHead = [...addedPaths, ...modifiedPaths].slice(0, MAX_BLOBS);
  // Prioritise removedPaths first so they always get their base content; modified
  // entries that exceed the cap will be missing base data but still appear in headNodes.
  const changedInBase = [...removedPaths, ...modifiedPaths].slice(0, MAX_BLOBS);

  const limit = pLimit(8);
  const headContents = new Map();
  const baseContents = new Map();

  await Promise.all([
    ...changedInHead.map((p) => limit(async () => {
      try {
        headContents.set(p, await fetchBlob(octokit, owner, name, headFiles.get(p).sha));
      } catch (e) {
        console.warn(`[diffService] Failed to fetch ${p}@head: ${e.message}`);
      }
    })),
    ...changedInBase.map((p) => limit(async () => {
      try {
        baseContents.set(p, await fetchBlob(octokit, owner, name, baseFiles.get(p).sha));
      } catch (e) {
        console.warn(`[diffService] Failed to fetch ${p}@base: ${e.message}`);
      }
    })),
  ]);

  // Parse all fetched file contents
  const headNodes = new Map();
  const baseNodes = new Map();
  const allHeadPaths = new Set(headFiles.keys());
  const allBasePaths = new Set(baseFiles.keys());

  for (const [p, content] of headContents) {
    try {
      const parsed = parseFile(p, content, allHeadPaths);
      headNodes.set(p, {
        file_path: p,
        language: getLanguage(p),
        line_count: content.split('\n').length,
        complexity_score: parsed.complexity || 1,
        imports: parsed.imports || [],
      });
    } catch (e) {
      console.warn(`[diffService] Failed to parse ${p}@head: ${e.message}`);
    }
  }

  for (const [p, content] of baseContents) {
    try {
      const parsed = parseFile(p, content, allBasePaths);
      baseNodes.set(p, {
        file_path: p,
        language: getLanguage(p),
        line_count: content.split('\n').length,
        complexity_score: parsed.complexity || 1,
        imports: parsed.imports || [],
      });
    } catch (e) {
      console.warn(`[diffService] Failed to parse ${p}@base: ${e.message}`);
    }
  }

  // Build edge sets from changed-file imports
  const headEdgeSet = new Set();
  const baseEdgeSet = new Set();

  for (const [p, node] of headNodes) {
    for (const imp of node.imports) {
      headEdgeSet.add(`${p}\x00${imp}`);
    }
  }

  for (const [p, node] of baseNodes) {
    for (const imp of node.imports) {
      baseEdgeSet.add(`${p}\x00${imp}`);
    }
  }

  const addedEdges = [];
  const removedEdges = [];

  for (const e of headEdgeSet) {
    if (!baseEdgeSet.has(e)) {
      const sep = e.indexOf('\x00');
      addedEdges.push({ from_path: e.slice(0, sep), to_path: e.slice(sep + 1) });
    }
  }

  for (const e of baseEdgeSet) {
    if (!headEdgeSet.has(e)) {
      const sep = e.indexOf('\x00');
      removedEdges.push({ from_path: e.slice(0, sep), to_path: e.slice(sep + 1) });
    }
  }

  // Complexity deltas for modified files
  const complexityDeltas = [];
  for (const p of modifiedPaths) {
    const headNode = headNodes.get(p);
    const baseNode = baseNodes.get(p);
    if (headNode && baseNode) {
      complexityDeltas.push({
        file_path: p,
        base_complexity: baseNode.complexity_score,
        head_complexity: headNode.complexity_score,
        delta: headNode.complexity_score - baseNode.complexity_score,
        base_lines: baseNode.line_count,
        head_lines: headNode.line_count,
      });
    }
  }
  complexityDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Detect new architectural issues in head that weren't present in base.
  // The canonical god-file definition also checks incoming_count (coupling), but that
  // requires the full repo graph which isn't available in a diff-only parse.
  // We apply the two complexity/size conditions that ARE computable here:
  //   • complexity_score > 30
  //   • line_count > 500  (the full rule is line_count > 500 AND high coupling, but we
  //     flag it conservatively; users can verify incoming_count in the main Issues panel)
  const newIssues = [];

  for (const p of [...addedPaths, ...modifiedPaths]) {
    const headNode = headNodes.get(p);
    if (!headNode) continue;

    const isGodFileNow = headNode.complexity_score > 30 || headNode.line_count > 500;
    if (isGodFileNow) {
      const baseNode = baseNodes.get(p);
      const wasGodFile = baseNode && (baseNode.complexity_score > 30 || baseNode.line_count > 500);
      if (!wasGodFile) {
        newIssues.push({
          type: 'god_file',
          severity: 'medium',
          file_path: p,
          description: `${p} newly exceeds god-file thresholds (complexity: ${headNode.complexity_score}, lines: ${headNode.line_count})`,
        });
      }
    }

    const outgoingCount = headNode.imports.length;
    if (outgoingCount > 15) {
      const baseNode = baseNodes.get(p);
      const wasHighCoupling = baseNode && baseNode.imports.length > 15;
      if (!wasHighCoupling) {
        const sev = outgoingCount >= 30 ? 'high' : outgoingCount >= 20 ? 'medium' : 'low';
        newIssues.push({
          type: 'high_coupling',
          severity: sev,
          file_path: p,
          description: `${p} newly has ${outgoingCount} outgoing dependencies`,
        });
      }
    }
  }

  // Build the diff node list
  const diffNodes = [];

  for (const p of addedPaths) {
    const node = headNodes.get(p);
    diffNodes.push({
      file_path: p,
      language: getLanguage(p),
      status: 'added',
      complexity_score: node?.complexity_score ?? 0,
      line_count: node?.line_count ?? 0,
    });
  }

  for (const p of removedPaths) {
    const node = baseNodes.get(p);
    diffNodes.push({
      file_path: p,
      language: getLanguage(p),
      status: 'removed',
      complexity_score: node?.complexity_score ?? 0,
      line_count: node?.line_count ?? 0,
    });
  }

  for (const p of modifiedPaths) {
    const headNode = headNodes.get(p);
    const baseNode = baseNodes.get(p);
    diffNodes.push({
      file_path: p,
      language: getLanguage(p),
      status: 'modified',
      complexity_score: headNode?.complexity_score ?? 0,
      line_count: headNode?.line_count ?? 0,
      base_complexity: baseNode?.complexity_score ?? 0,
      base_line_count: baseNode?.line_count ?? 0,
    });
  }

  for (const p of unchangedPaths) {
    diffNodes.push({ file_path: p, language: getLanguage(p), status: 'unchanged' });
  }

  return {
    base_ref: baseRef,
    head_ref: headRef,
    base_sha: baseCommit.sha,
    head_sha: headCommit.sha,
    identical: false,
    summary: {
      added_files: addedPaths.length,
      removed_files: removedPaths.length,
      modified_files: modifiedPaths.length,
      unchanged_files: unchangedPaths.length,
      added_edges: addedEdges.length,
      removed_edges: removedEdges.length,
      new_issues: newIssues,
      complexity_deltas: complexityDeltas,
    },
    nodes: diffNodes,
    edges: { added: addedEdges, removed: removedEdges },
  };
}

module.exports = { computeArchDiff };
