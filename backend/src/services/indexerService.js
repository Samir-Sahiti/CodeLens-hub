const { parseFile } = require('../parsers/repositoryParser');
const { parseFileInPool } = require('../parsers/parserPool'); // Phase 5.1
const { extractChunksFromFile } = require('../parsers/chunkParser');
const { detectIssues } = require('./issueDetection');
const { scanFileForSecrets } = require('./secretScanner');
const { scanFileForInsecurePatterns } = require('./sastEngine'); // US-046
const { scanFileForMissingAuth } = require('./authCoverageScanner'); // US-049
const { classifyFile } = require('./attackSurfaceClassifier'); // US-047
const { fetchRepoChurn, applyIncrementalChurn, readChurnFromDb } = require('./churnService'); // US-050
const { detectDuplicateCandidates } = require('./duplicationScanner'); // US-052
const { isTestFilePath, parseCoverageOverrides } = require('./testCoverageService'); // US-053
const { recordUsage } = require('./usageTracker'); // US-042
const { isManifestFile, parseManifest } = require('./manifestParser'); // US-045
const { scanDependencies } = require('./osvScanner'); // US-045
const { generateStartHereTour } = require('./startHereTourService'); // US-059
const { enqueueNotification, recipientsForRepo } = require('./notifications'); // US-077
const { scoreIssuesForRepo } = require('./riskScoring'); // US-079
const { computeSnapshot } = require('../lib/snapshotRepo'); // US-081
const { OpenAI } = require('openai');
const { supabaseAdmin } = require('../db/supabase');
const { SAFE_FETCH_CEILING, warnIfCeilingHit, withSupabaseRetry } = require('../lib/dbHelpers');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-dummy' });
const pLimit = require('p-limit');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function duplicationDemoFallbackEnabled() {
  return String(process.env.ENABLE_DUPLICATION_DEMO_FALLBACK || '').toLowerCase() === 'true';
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function markRepoReady({ repoId, fileCount, hasCoverageFiles, finalNodes, latestIndexedSha = null }) {
  const updates = {
    status: 'ready',
    indexed_at: new Date().toISOString(),
    file_count: fileCount,
    has_coverage_files: hasCoverageFiles,
    language_stats: Object.entries(
      finalNodes.reduce((acc, n) => {
        const lang = n.language || 'unknown';
        acc[lang] = (acc[lang] || 0) + 1;
        return acc;
      }, {})
    ).map(([language, count]) => ({ language, count })).sort((a, b) => b.count - a.count),
  };
  if (latestIndexedSha) updates.latest_indexed_sha = latestIndexedSha;

  await supabaseAdmin
    .from('repositories')
    .update(updates)
    .eq('id', repoId);
}

const VALID_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.cs', '.go', '.java', '.rs', '.rb']);

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function fetchGithubZipAndExtract(owner, name, token, destDir) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}/zipball/HEAD`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json'
    }
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`GitHub repository '${owner}/${name}' not found or insufficient OAuth permissions.`);
    }
    throw new Error(`Failed to download zipball: ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(Buffer.from(arrayBuffer));
  zip.extractAllTo(destDir, true);
}

async function fetchLocalFiles(dir, baseDir = dir, results = []) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      // Create cross-platform relative path using posix separators
      const relativePath = path.relative(baseDir, fullPath).split(path.sep).join('/');
      if (entry.isDirectory()) {
        await fetchLocalFiles(fullPath, baseDir, results);
      } else {
        if (VALID_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
          results.push({ path: relativePath, fsPath: fullPath, content: null });
        }
      }
    }
  } catch (err) {
    console.warn(`[indexer] Failed to read directory ${dir}: ${err.message}`);
  }
  return results;
}



/**
 * Full indexing pipeline for a repository.
 * @param {Object} params
 * @param {string} params.repoId - Internal repo UUID
 * @param {string} [params.owner] - GitHub owner
 * @param {string} [params.name] - GitHub repo name
 * @param {string} [params.token] - GitHub access token
 * @param {string} [params.extractPath] - Path to extracted local zip
 * @param {string} params.source - 'github' or 'upload'
 */
const indexRepository = async ({ repoId, owner, name, token, extractPath, source, incrementalChurnCommits, latestIndexedSha = null }) => {
  let zipTempDir = null;
  try {
    console.log(`[indexer] Starting indexing for repoId: ${repoId} (source: ${source})`);
    console.time(`[indexer] Total pipeline (${repoId})`);

    // Fetch existing node hashes BEFORE clearing — used for incremental indexing.
    // If the content_hash column doesn't exist yet (old schema), we get an empty result
    // and fall back to a full index on this run.
    const { data: existingNodeRows } = await supabaseAdmin
      .from('graph_nodes')
      .select('file_path, content_hash, language, line_count, complexity_score, node_classification, is_test_file')
      .eq('repo_id', repoId)
      .range(0, SAFE_FETCH_CEILING - 1);
    warnIfCeilingHit('indexer.graph_nodes pre-fetch', existingNodeRows);
    const existingNodeMap = new Map((existingNodeRows || []).map(n => [n.file_path, n]));

    // Also pre-fetch existing edges for unchanged files (we'll reuse them to skip re-parsing imports).
    // `symbols` is the US-064 per-importer symbol list — empty array on edges written before that migration.
    const { data: existingEdgeRows } = await supabaseAdmin
      .from('graph_edges')
      .select('from_path, to_path, symbols')
      .eq('repo_id', repoId)
      .range(0, SAFE_FETCH_CEILING - 1);
    warnIfCeilingHit('indexer.graph_edges pre-fetch', existingEdgeRows);

    // Phase 2.3: pull repo metadata in ONE fetch instead of separately fetching
    // user_id here and sast_disabled_rules later in the parsing phase.
    const { data: repoMeta } = await supabaseAdmin
      .from('repositories')
      .select('user_id, sast_disabled_rules, dependency_auto_pr_enabled, dependency_batch_threshold, dependency_update_strategy')
      .eq('id', repoId)
      .single();
    const repoUserId = repoMeta?.user_id || null;
    const disabledSastRules = repoMeta?.sast_disabled_rules || [];

    // 1. Fetch & filter files
    console.time(`[indexer] Phase 1: File discovery (${repoId})`);
    let pendingFiles = [];
    const manifestFiles = [];
    let extractDir = extractPath;
    
    if (source === 'github') {
      const os = require('os');
      zipTempDir = await fs.mkdtemp(path.join(os.tmpdir(), `codelens-github-${repoId}-`));
      extractDir = zipTempDir;
      await fetchGithubZipAndExtract(owner, name, token, extractDir);

      // The zip extracts into a subfolder like `owner-repo-commitSha`.
      // We want to fetch all files starting from that subfolder so relative paths are correct.
      const entries = await fs.readdir(extractDir, { withFileTypes: true });
      const rootFolder = entries.find(e => e.isDirectory());
      if (rootFolder) {
        extractDir = path.join(extractDir, rootFolder.name);
      }
      pendingFiles = await fetchLocalFiles(extractDir);
    } else if (source === 'upload') {
      pendingFiles = await fetchLocalFiles(extractPath);
    }

    // Sort so the same repo produces the same node/edge array on every re-index.
    // fs.readdir returns entries in filesystem order, which varies across hosts
    // and zipball extractions, and that non-determinism propagates through the
    // whole pipeline into the D3 graph layout.
    pendingFiles.sort((a, b) => a.path.localeCompare(b.path));

    const getAllFilesSet = new Set(pendingFiles.map(f => f.path));
    console.timeEnd(`[indexer] Phase 1: File discovery (${repoId})`);
    console.log(`[indexer] Discovered ${pendingFiles.length} files to index.`);

    // US-045: Scan filesystem for manifest files (now for both github and upload)
      console.time(`[indexer] Phase 1b: Manifest discovery (${repoId})`);
      const scanForManifests = async (dir, baseDir) => {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(baseDir, fullPath).split(path.sep).join('/');
            if (entry.isDirectory()) {
              if (['node_modules', '.git', 'vendor', '__pycache__', '.cache'].includes(entry.name)) continue;
              await scanForManifests(fullPath, baseDir);
            } else if (isManifestFile(relativePath)) {
              manifestFiles.push({ path: relativePath, fsPath: fullPath, content: null });
            }
          }
        } catch (scanDirErr) {
          console.warn(`[indexer] Manifest scan failed for ${dir}: ${scanDirErr.message}`);
        }
      };
      await scanForManifests(extractDir, extractDir);
      manifestFiles.sort((a, b) => a.path.localeCompare(b.path));
      console.timeEnd(`[indexer] Phase 1b: Manifest discovery (${repoId})`);

    console.log(`[indexer] Discovered ${manifestFiles.length} manifest file(s) for SCA.`);

    // ── Incremental delta: read all content + compute hashes ──────────────────
    console.time(`[indexer] Phase 1c: Hash computation (${repoId})`);
    const readLimit = pLimit(20);
    await Promise.all(pendingFiles.map(file => readLimit(async () => {
      try {
        if (!file.content) file.content = await fs.readFile(file.fsPath, 'utf-8');
        file.contentHash = sha256(file.content);
      } catch (readErr) {
        console.warn(`[indexer] Failed to read ${file.path}: ${readErr.message}`);
      }
    })));
    console.timeEnd(`[indexer] Phase 1c: Hash computation (${repoId})`);

    const currentFilePaths = new Set(pendingFiles.map(f => f.path));
    const deletedFilePaths = [...existingNodeMap.keys()].filter(p => !currentFilePaths.has(p));

    const unchangedFilePaths = new Set();
    const changedFilePaths = new Set();
    for (const file of pendingFiles) {
      const existing = existingNodeMap.get(file.path);
      if (existing && existing.content_hash && existing.content_hash === file.contentHash) {
        unchangedFilePaths.add(file.path);
      } else {
        changedFilePaths.add(file.path);
      }
    }

    console.log(`[indexer] Incremental: ${unchangedFilePaths.size} unchanged, ${changedFilePaths.size} changed/new, ${deletedFilePaths.length} deleted`);

    const changedOrDeletedPaths = [...changedFilePaths, ...deletedFilePaths];

    // ── Phase 2.1: single RPC handles issue preservation + clearing ───────────
    // prepare_repo_reindex performs proposal stale-marking, non-preservable
    // issue delete, dependency_manifests + graph_edges + duplication_candidates
    // wipes, optional file_churn wipe, coverage-flag reset, and the partial
    // node/chunk/file_contents purge for changed-or-deleted files — all in one
    // transactional SQL function. Replaces ~10 sequential PostgREST round-trips.
    const preserveChurn = Array.isArray(incrementalChurnCommits) && incrementalChurnCommits.length > 0;
    const { data: prepareResult, error: prepareErr } = await withSupabaseRetry(
      () => supabaseAdmin.rpc('prepare_repo_reindex', {
        p_repo_id: repoId,
        p_unchanged_paths: [...unchangedFilePaths],
        p_changed_or_deleted_paths: changedOrDeletedPaths,
        p_preserve_churn: preserveChurn,
      }),
      { label: 'indexer.prepare_repo_reindex' },
    );

    if (prepareErr) {
      throw new Error(`prepare_repo_reindex failed: ${prepareErr.message}`);
    }

    // RPC returns a one-row table; supabase-js wraps it as an array.
    const report = Array.isArray(prepareResult) ? prepareResult[0] : prepareResult;
    console.log(`[indexer] Issues: ${report?.preserved_count ?? 0} preserved, ${report?.deleted_count ?? 0} deleted (single-RPC prepare)`);

    const limit = pLimit(10);
    // `issues` accumulates only newly-detected issues. Preserved (unchanged-file)
    // issues remain in the DB with their original ids — we never re-insert them.
    const issues = [];

    // Fetch existing suppressions for this repo BEFORE scanning
    const { data: suppressions } = await supabaseAdmin
      .from('issue_suppressions')
      .select('file_path, rule_id, line_number')
      .eq('repo_id', repoId);
    const suppSet = new Set(suppressions?.map(s => `${s.file_path}:${s.rule_id}:${s.line_number}`) || []);

    // sast_disabled_rules (US-046) was already loaded with the repo metadata above.

    // 2.5 Optional Pre-pass for C# Namespaces (US-011)
    const namespaceMap = new Map();
    // Files that need to be parsed (changed or new) — defined here for use by pre-pass and parsing phase
    const filesToProcess = pendingFiles.filter(f => changedFilePaths.has(f.path));

    const isCSharpRepo = pendingFiles.some(f => f.path.toLowerCase().endsWith('.cs'));

    // Phase 5.3: cache C# parses between the pre-pass and the main pass. The
    // pre-pass needs `exports` (namespaces); the main pass needs the full
    // parsed result with resolved imports. Without this cache, every .cs file
    // is parsed twice. We key by file path (content_hash is implied — only
    // changed files reach this point).
    const csharpPreParse = new Map();

    if (isCSharpRepo) {
      console.log(`[indexer] C# files detected. Running namespace pre-pass on changed files...`);
      await Promise.all(
        filesToProcess.map(file =>
          limit(async () => {
            if (!file.path.toLowerCase().endsWith('.cs')) return;
            try {
              if (!file.content) {
                file.content = await fs.readFile(file.fsPath, 'utf-8');
              }
              // Pre-pass stays in-process: parses produce a Set-based namespace
              // map that's mutated below, which is awkward to ship through the
              // worker pool. The cached result feeds the main pass.
              const parsed = parseFile(file.path, file.content, getAllFilesSet);
              csharpPreParse.set(file.path, parsed);
              for (const ns of parsed.exports) {
                if (!namespaceMap.has(ns)) namespaceMap.set(ns, new Set());
                namespaceMap.get(ns).add(file.path);
              }
            } catch (err) {
              console.warn(`[indexer] Failed pre-pass for ${file.path}: ${err.message}`);
            }
          })
        )
      );
      // Convert sets to arrays for easier usage in resolver
      for (const [ns, paths] of namespaceMap.entries()) {
        namespaceMap.set(ns, Array.from(paths));
      }
    }

    const parsedFiles = [];
    let parsedCount = 0;

    // 3. parse (with concurrency) and 4. resolve imports
    // Only process files that changed or are new — unchanged files reuse their DB state.
    console.time(`[indexer] Phase 2: Parsing (${repoId})`);
    console.log(`[indexer] Parsing ${filesToProcess.length} changed/new files (skipping ${unchangedFilePaths.size} unchanged)`);
    await Promise.all(
      filesToProcess.map(file =>
        limit(async () => {
          try {
            // Content might already be loaded from pre-pass
            if (!file.content) {
              file.content = await fs.readFile(file.fsPath, 'utf-8');
            }

            // Phase 5.1 + 5.3: parse via the worker pool, except .cs files
            // (which (a) need the namespace map for resolution, awkward to
            // pass over the wire, and (b) already have a cached pre-pass tree
            // we can reuse to skip the dominant tree-sitter parse cost).
            let parsed;
            const isCs = file.path.toLowerCase().endsWith('.cs');
            if (isCs) {
              const cached = csharpPreParse.get(file.path);
              const cachedTree = cached && cached._tree ? cached._tree : null;
              parsed = parseFile(
                file.path,
                file.content,
                namespaceMap,
                cachedTree
                  ? { cachedTree, cachedComplexity: cached.complexity }
                  : {},
              );
              // Free the cached tree as soon as the main pass consumes it.
              csharpPreParse.delete(file.path);
            } else {
              parsed = await parseFileInPool({
                filePath: file.path,
                content: file.content,
                allFiles: getAllFilesSet,
              });
            }
            parsedFiles.push(parsed);

            // Secret scanning (US-044)
            try {
              const secretIssues = await scanFileForSecrets(file.path, file.content);
              const validSecrets = secretIssues.filter(is => {
                const key = `${file.path}:${is._meta.rule_id}:${is._meta.line_number}`;
                return !suppSet.has(key);
              });

              validSecrets.forEach(is => {
                delete is._meta;
                is.repo_id = repoId;
                issues.push(is);
              });
            } catch (scanErr) {
              console.warn(`[indexer] Secret scan failed for ${file.path}: ${scanErr.message}`);
            }

            // SAST pattern scanning (US-046)
            try {
              const sastIssues = await scanFileForInsecurePatterns(
                file.path,
                file.content,
                disabledSastRules
              );
              sastIssues.forEach(issue => {
                issue.repo_id = repoId;
                delete issue._meta;
                issues.push(issue);
              });
            } catch (sastErr) {
              console.warn(`[indexer] SAST scan failed for ${file.path}: ${sastErr.message}`);
            }

            // Auth coverage check (US-049)
            try {
              const authIssues = scanFileForMissingAuth(file.path, file.content, parsed.imports || []);
              const validAuthIssues = authIssues.filter(is => {
                const key = `${file.path}:${is._meta.rule_id}:${is._meta.line_number}`;
                return !suppSet.has(key);
              });
              validAuthIssues.forEach(is => {
                delete is._meta;
                is.repo_id = repoId;
                issues.push(is);
              });
            } catch (authErr) {
              console.warn(`[indexer] Auth coverage scan failed for ${file.path}: ${authErr.message}`);
            }

            parsedCount += 1;
            if (parsedCount % 100 === 0) {
              console.log(`[indexer] Parsed ${parsedCount}/${pendingFiles.length} files...`);
            }
          } catch (err) {
            console.warn(`[indexer] Failed to process ${file.path}: ${err.message}`);
          }
        })
      )
    );
    console.timeEnd(`[indexer] Phase 2: Parsing (${repoId})`);

    // 5. dedupe nodes (in memory)
    // Seed with unchanged nodes from DB so they still appear in the final graph.
    const nodeMap = new Map();
    const allEdges = [];
    let fileCount = pendingFiles.length;

    // Reconstruct unchanged nodes from DB snapshot
    for (const filePath of unchangedFilePaths) {
      const existing = existingNodeMap.get(filePath);
      if (existing) {
        nodeMap.set(filePath, {
          repo_id: repoId,
          file_path: filePath,
          language: existing.language || 'unknown',
          line_count: existing.line_count || 0,
          complexity_score: existing.complexity_score || 1,
          content_hash: existing.content_hash,
          node_classification: existing.node_classification || null,
          has_test_coverage: false,
          is_test_file: isTestFilePath(filePath),
          coverage_percentage: null,
          outgoing_count: 0,
          incoming_count: 0,
        });
      }
    }

    // Reconstruct edges originating from unchanged files (symbols carried forward)
    for (const edge of (existingEdgeRows || [])) {
      if (unchangedFilePaths.has(edge.from_path)) {
        allEdges.push({
          repo_id: repoId,
          from_path: edge.from_path,
          to_path: edge.to_path,
          symbols: Array.isArray(edge.symbols) ? edge.symbols : [],
        });
      }
    }

    for (const file of parsedFiles) {
      if (!file) continue;

      const originalFile = pendingFiles.find(f => f.path === file.filePath);
      const lineCount = (originalFile && originalFile.content) ? originalFile.content.split('\n').length : 0;

      // Ensure language handles no-extension case gracefully, fallback unknown
      const ext = path.extname(file.filePath).toLowerCase();
      let language = 'unknown';
      if (['.js', '.jsx'].includes(ext)) language = 'javascript';
      else if (['.ts', '.tsx'].includes(ext)) language = 'typescript';
      else if (ext === '.py') language = 'python';
      else if (ext === '.cs') language = 'c_sharp';
      else if (ext === '.go') language = 'go';
      else if (ext === '.java') language = 'java';
      else if (ext === '.rs') language = 'rust';
      else if (ext === '.rb') language = 'ruby';

      nodeMap.set(file.filePath, {
        repo_id: repoId,
        file_path: file.filePath,
        language: language,
        line_count: lineCount,
        outgoing_count: 0,
        incoming_count: 0,
        complexity_score: file.complexity || 1,
        content_hash: originalFile?.contentHash || null,
        node_classification: originalFile?.content ? classifyFile(file.filePath, originalFile.content) : null,
        has_test_coverage: false,
        is_test_file: isTestFilePath(file.filePath),
        coverage_percentage: null,
      });

      const importSymbols = file.importSymbols || {};
      for (const imp of file.imports) {
        // US-064: edges carry the per-importer symbol list when the parser
        // can extract it. Empty array on languages or import forms where we
        // can't reliably name the imported symbols.
        allEdges.push({
          repo_id: repoId,
          from_path: file.filePath,
          to_path: imp,
          symbols: Array.isArray(importSymbols[imp]) ? importSymbols[imp] : [],
        });
      }
    }

    // Dedupe edges in memory, unioning symbols across duplicate (from, to) pairs.
    const edgeMap = new Map();
    for (const edge of allEdges) {
      const edgeKey = `${edge.from_path}->${edge.to_path}`;
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, { ...edge, symbols: [...(edge.symbols || [])] });
      } else {
        const existing = edgeMap.get(edgeKey);
        const merged = new Set([...(existing.symbols || []), ...(edge.symbols || [])]);
        existing.symbols = [...merged];
      }
    }
    const uniqueEdges = Array.from(edgeMap.values());
    let uniqueNodes = Array.from(nodeMap.values());

    const testFilesSet = new Set(uniqueNodes.filter((node) => node.is_test_file).map((node) => node.file_path));
    const heuristicCoveredPaths = new Set();
    for (const edge of uniqueEdges) {
      if (testFilesSet.has(edge.from_path)) heuristicCoveredPaths.add(edge.to_path);
    }

    const { coverageByPath, hasCoverageFiles } = await parseCoverageOverrides(extractDir, uniqueNodes.map((node) => node.file_path));
    uniqueNodes = uniqueNodes.map((node) => {
      const hasFormalCoverage = coverageByPath.has(node.file_path);
      return {
        ...node,
        is_test_file: isTestFilePath(node.file_path),
        has_test_coverage: hasFormalCoverage ? false : heuristicCoveredPaths.has(node.file_path),
        coverage_percentage: hasFormalCoverage ? coverageByPath.get(node.file_path) : null,
      };
    });
    console.log(`[indexer] Coverage: ${testFilesSet.size} test file(s), ${heuristicCoveredPaths.size} heuristic target(s), ${coverageByPath.size} formal override(s).`);

    // 6. bulk insert nodes (retry on transient 5xx / 429 / network errors)
    console.time(`[indexer] Phase 3: DB writes (${repoId})`);
    const nodeChunks = chunkArray(uniqueNodes, 500);
    for (const chunk of nodeChunks) {
      const { error } = await withSupabaseRetry(
        () => supabaseAdmin.from('graph_nodes').upsert(chunk, { onConflict: 'repo_id,file_path', ignoreDuplicates: true }),
        { label: 'indexer.graph_nodes.upsert' },
      );
      if (error) throw new Error(`Database error inserting nodes: ${error.message}`);
    }

    // 7. bulk insert edges
    const edgeChunks = chunkArray(uniqueEdges, 500);
    for (const chunk of edgeChunks) {
      const { error } = await withSupabaseRetry(
        () => supabaseAdmin.from('graph_edges').upsert(chunk, { onConflict: 'repo_id,from_path,to_path', ignoreDuplicates: true }),
        { label: 'indexer.graph_edges.upsert' },
      );
      if (error) throw new Error(`Database error inserting edges: ${error.message}`);
    }

    // 8. compute metrics
    const outgoingMap = {};
    const incomingMap = {};

    uniqueEdges.forEach(edge => {
      outgoingMap[edge.from_path] = (outgoingMap[edge.from_path] || 0) + 1;
      incomingMap[edge.to_path] = (incomingMap[edge.to_path] || 0) + 1;
    });

    const finalNodes = uniqueNodes.map(node => {
      const outC = outgoingMap[node.file_path] || 0;
      const inC = incomingMap[node.file_path] || 0;
      node.outgoing_count = outC;
      node.incoming_count = inC;
      // US-040: Using true cyclomatic complexity from AST tree
      return node;
    });

    // 8b. persist metrics to graph_nodes via update
    const metricsChunks = chunkArray(finalNodes, 500);
    for (const chunk of metricsChunks) {
      const { error } = await withSupabaseRetry(
        () => supabaseAdmin.from('graph_nodes').upsert(chunk, { onConflict: 'repo_id,file_path', ignoreDuplicates: false }), // false to DO UPDATE
        { label: 'indexer.graph_nodes.metrics' },
      );
      if (error) throw new Error(`Database error updating metrics: ${error.message}`);
    }
    console.timeEnd(`[indexer] Phase 3: DB writes (${repoId})`);

    // 9. issue detection
    // (issues array initialized earlier to collect secret scan results)
    issues.push(...detectIssues({ repoId, nodes: finalNodes, edges: uniqueEdges, hasCoverageFiles }));

    // US-045: Dependency vulnerability scanning (SCA) — best-effort, never blocks pipeline
    try {
      if (manifestFiles.length > 0) {
        console.time(`[indexer] Phase SCA: Dependency scanning (${repoId})`);

        const allDeps = [];

        for (const mf of manifestFiles) {
          try {
            if (!mf.content) {
              mf.content = await fs.readFile(mf.fsPath, 'utf-8');
            }
            const parsed = parseManifest(mf.path, mf.content);
            allDeps.push(...parsed);
          } catch (parseErr) {
            console.warn(`[indexer] Failed to fetch/parse manifest ${mf.path}: ${parseErr.message}`);
          }
        }

        console.log(`[indexer] Parsed ${allDeps.length} dependencies from ${manifestFiles.length} manifest(s).`);

        if (allDeps.length > 0) {
          const { issues: scaIssues, depResults } = await scanDependencies(allDeps, repoId);

          // Append SCA issues to the main issues array before the bulk insert below
          issues.push(...scaIssues);
          console.log(`[indexer] SCA found ${scaIssues.length} vulnerability issue(s).`);

          // Store per-package dependency results for the Dependencies tab
          if (depResults.length > 0) {
            // Deduplicate by the upsert conflict key before inserting — duplicate tuples
            // within a single batch cause "ON CONFLICT DO UPDATE command cannot affect row
            // a second time" (package-lock.json v2/v3 lists packages in both the legacy
            // `dependencies` and the new `packages` sections, producing the same row twice).
            const seen = new Set();
            const depRows = [];
            for (const d of depResults) {
              const key = `${d.manifest_path}::${d.ecosystem}::${d.package_name}::${d.version}`;
              if (seen.has(key)) continue;
              seen.add(key);
              depRows.push({
                repo_id: repoId,
                manifest_path: d.manifest_path,
                ecosystem: d.ecosystem,
                package_name: d.package_name,
                pkg_version: d.version,
                is_transitive: d.is_transitive,
                vuln_count: d.vuln_count,
                vulns_json: d.vulns_json,
              });
            }

            const depChunks = chunkArray(depRows, 200);
            for (const chunk of depChunks) {
              const { error: depErr } = await supabaseAdmin
                .from('dependency_manifests')
                .upsert(chunk, { onConflict: 'repo_id,manifest_path,ecosystem,package_name,pkg_version', ignoreDuplicates: false });
              if (depErr) console.warn(`[indexer] dependency_manifests write error: ${depErr.message}`);
            }
          }
        }

        console.timeEnd(`[indexer] Phase SCA: Dependency scanning (${repoId})`);
      }
    } catch (scaErr) {
      console.warn(`[indexer] SCA scan failed (best-effort, non-blocking): ${scaErr.message}`);
    }

    // US-050 + US-079: Git history hotspots and 30-day churn metrics must be
    // available before the single issue risk-scoring pass below.
    if (source === 'github' && token) {
      try {
        console.time(`[indexer] Phase Churn (${repoId})`);

        const isIncremental = Array.isArray(incrementalChurnCommits) && incrementalChurnCommits.length > 0;
        if (isIncremental) {
          await applyIncrementalChurn(owner, name, token, repoId, incrementalChurnCommits);
        } else {
          await fetchRepoChurn(owner, name, token, repoId);
        }

        const churnMap = await readChurnFromDb(repoId);

        if (churnMap.size > 0) {
          const complexityMap = new Map(finalNodes.map(n => [n.file_path, n.complexity_score || 0]));
          const maxCount = Math.max(1, ...[...churnMap.values()].map(e => e.count));
          const maxComplexity = Math.max(1, ...[...complexityMap.values()]);

          const scoredFiles = [];
          for (const [filePath, entry] of churnMap.entries()) {
            const complexity = complexityMap.get(filePath) || 0;
            const score = (entry.count / maxCount) * (complexity / maxComplexity);
            if (score > 0) scoredFiles.push({ filePath, entry, complexity, score });
          }
          scoredFiles.sort((a, b) => b.score - a.score);

          const top10 = scoredFiles.slice(0, 10);
          if (top10.length > 0) {
            issues.push(...top10.map(({ filePath, entry, complexity, score }) => ({
              repo_id: repoId,
              type: 'refactoring_candidate',
              severity: score > 0.5 ? 'high' : 'medium',
              file_paths: [filePath],
              description: `Hotspot score ${(score * 100).toFixed(0)}/100 — ${entry.count} commits in 12 months by ${entry.authors.size} author${entry.authors.size !== 1 ? 's' : ''}, ${entry.lines.toLocaleString()} lines changed, cyclomatic complexity ${complexity.toFixed(1)}.`,
            })));
          }
        }
        console.timeEnd(`[indexer] Phase Churn (${repoId})`);
      } catch (churnErr) {
        console.warn(`[indexer] Churn analysis failed (best-effort, non-blocking): ${churnErr.message}`);
      }
    }

    await supabaseAdmin
      .from('analysis_issues')
      .delete()
      .eq('repo_id', repoId)
      .eq('type', 'untested_critical_file');

    if (issues.length > 0) {
      const scoredIssues = await scoreIssuesForRepo(repoId, issues, uniqueEdges);
      // Phase 2.2: bulk_insert_analysis_issues consolidates 1-N chunked inserts
      // into a single RPC. Shape validation (type non-null, file_paths
      // non-empty) is enforced server-side now.
      const issuePayload = scoredIssues
        .filter(issue => issue?.type && Array.isArray(issue.file_paths) && issue.file_paths.length > 0)
        .map(issue => ({
          type:        issue.type,
          severity:    issue.severity || null,
          file_paths:  issue.file_paths,
          description: issue.description || null,
          risk_score:  issue.risk_score == null ? null : issue.risk_score,
        }));
      if (issuePayload.length > 0) {
        const { error } = await withSupabaseRetry(
          () => supabaseAdmin.rpc('bulk_insert_analysis_issues', {
            p_repo_id: repoId,
            p_issues: issuePayload,
          }),
          { label: 'indexer.bulk_insert_analysis_issues' },
        );
        if (error) console.error(`[indexer] Database error inserting issues: ${error.message}`);
      }
    }

    // Core analysis is now usable. Mark the repo ready before slower best-effort
    // enrichment so the UI does not stay on the loading skeleton while optional
    // chunking, duplicate detection, or churn work finishes.
    await markRepoReady({ repoId, fileCount, hasCoverageFiles, finalNodes, latestIndexedSha });

    // US-081: generate daily snapshot for this repo to keep the 'today' data point fresh
    try {
      await computeSnapshot(repoId, supabaseAdmin);
      console.log(`[indexer] Generated daily snapshot post-index for ${repoId}`);
    } catch (snapCatchErr) {
      console.warn(`[indexer] Post-index snapshot generation threw: ${snapCatchErr.message}`);
    }

    // US-084: auto-open a batch fix PR when dependency_auto_pr_enabled and enough vulns found
    if (repoMeta?.dependency_auto_pr_enabled && repoUserId && token && source === 'github') {
      const threshold = repoMeta.dependency_batch_threshold ?? 3;
      try {
        const { data: vulnIssues } = await supabaseAdmin
          .from('analysis_issues')
          .select('id')
          .eq('repo_id', repoId)
          .eq('type', 'vulnerable_dependency');
        const vulnCount = (vulnIssues || []).length;
        if (vulnCount >= threshold) {
          const vulnIds = (vulnIssues || []).map(i => i.id);
          console.log(`[indexer] Auto-PR: ${vulnCount} vuln(s) >= threshold ${threshold}, triggering batch-proposal.`);
          // Fire-and-forget — never blocks the pipeline
          const { batchDependencyProposalInternal } = require('../controllers/reviewController');
          if (typeof batchDependencyProposalInternal === 'function') {
            batchDependencyProposalInternal({ repoId, userId: repoUserId, vulnerabilityIds: vulnIds }).catch((autoErr) => {
              console.warn('[indexer] Auto-PR batch proposal failed:', autoErr.message);
            });
          }
        }
      } catch (autoErr) {
        console.warn('[indexer] Auto-PR trigger failed (best-effort):', autoErr.message);
      }
    }

    // US-077: notify recipients that the index is ready and surface newly-introduced
    // critical/high issues + vulnerabilities. Best-effort — never blocks the pipeline.
    // The 30-day dedup_key prevents re-notifying for issues seen on a prior index.
    try {
      const recipients = await recipientsForRepo(repoId);
      if (recipients.length > 0) {
        await enqueueNotification({
          user_ids: recipients,
          repo_id: repoId,
          type: 'index_ready',
          severity: 'info',
          payload: { file_count: fileCount },
          link_url: `/repo/${repoId}`,
        });

        const { data: importantIssues } = await supabaseAdmin
          .from('analysis_issues')
          .select('id, type, severity, file_paths, description')
          .eq('repo_id', repoId)
          .in('severity', ['critical', 'high']);

        for (const issue of importantIssues || []) {
          const filePath = Array.isArray(issue.file_paths) ? issue.file_paths[0] : null;
          const isVuln = issue.type === 'vulnerable_dependency';
          await enqueueNotification({
            user_ids: recipients,
            repo_id: repoId,
            type: isVuln ? 'new_vulnerability' : 'new_critical_issue',
            severity: issue.severity === 'critical' ? 'critical' : 'warning',
            payload: { issue_id: issue.id, file_path: filePath, rule_id: issue.type, message: issue.description },
            link_url: `/repo/${repoId}?tab=issues&issue=${issue.id}`,
            dedup_key: `${issue.type}::${filePath || ''}::${(issue.description || '').slice(0, 80)}`,
          });
        }
      }
    } catch (notifyErr) {
      console.warn('[indexer] notification emission failed:', notifyErr.message || notifyErr);
    }

    // 10. Store full file contents (US-043) — only for changed/new files
    // Unchanged files already have their content rows in the DB.
    const FILE_SIZE_CAP = 1024 * 1024; // 1 MB
    const fileContentRows = [];
    for (const file of pendingFiles) {
      if (!changedFilePaths.has(file.path)) continue; // skip unchanged
      if (!file.content) continue;
      const raw = file.content;
      const truncated = raw.length > FILE_SIZE_CAP;
      fileContentRows.push({
        repo_id:   repoId,
        file_path: file.path,
        content:   truncated ? raw.slice(0, FILE_SIZE_CAP) + '\n\n/* [CodeLens] File truncated at 1 MB */' : raw,
        byte_size: Buffer.byteLength(raw, 'utf8'),
      });
    }
    if (fileContentRows.length > 0) {
      const fcBatches = chunkArray(fileContentRows, 200);
      for (const batch of fcBatches) {
        const { error: fcErr } = await withSupabaseRetry(
          () => supabaseAdmin.from('file_contents').upsert(batch, { onConflict: 'repo_id,file_path', ignoreDuplicates: false }),
          { label: 'indexer.file_contents.upsert' },
        );
        // file_contents drives RAG retrieval — promote from warning to error so we
        // notice silent breakage. Retry already handled transient cases above.
        if (fcErr) console.error(`[indexer] file_contents insert error (RAG retrieval may be incomplete): ${fcErr.message}`);
      }
    }
    console.log(`[indexer] Stored ${fileContentRows.length} file contents.`);

    // 11. Extract Semantic Chunks and Embed Vectors (US-017)
    if (!process.env.OPENAI_API_KEY) {
      console.log('[indexer] No OPENAI_API_KEY set — skipping embedding step.');
      if (duplicationDemoFallbackEnabled()) {
        try {
          console.log(`[indexer] ENABLE_DUPLICATION_DEMO_FALLBACK=true — storing text-only chunks for ${repoId}`);
          const fallbackChunks = [];
          for (const file of pendingFiles) {
            if (!changedFilePaths.has(file.path)) continue;
            if (!file.content) continue;
            fallbackChunks.push(...extractChunksFromFile(file.path, file.content, repoId).map(chunk => ({
              repo_id: chunk.repo_id,
              file_path: chunk.file_path,
              start_line: chunk.start_line,
              end_line: chunk.end_line,
              content: chunk.content,
              embedding: null,
            })));
          }

          let insertedFallbackChunks = 0;
          if (fallbackChunks.length > 0) {
            const insertBatches = chunkArray(fallbackChunks, 500);
            for (const insBatch of insertBatches) {
              const { error: insErr } = await supabaseAdmin.from('code_chunks').insert(insBatch);
              if (insErr) console.error(`[indexer] DB insert err for fallback chunks: ${insErr.message}`);
              else insertedFallbackChunks += insBatch.length;
            }
          }

          if (insertedFallbackChunks > 0) {
            const result = await detectDuplicateCandidates(repoId, { allowTextFallback: true });
            console.log(`[indexer] Demo fallback duplication scan saved ${result.inserted || 0} candidate pair(s).`);
          } else {
            console.log('[indexer] Demo fallback duplication scan skipped; no changed/new text chunks were stored.');
          }
        } catch (fallbackErr) {
          console.warn(`[indexer] Demo fallback duplication scan failed: ${fallbackErr.message}`);
        }
      }
    } else {
      try {
        console.log(`[indexer] Starting semantic chunking and embedding for ${repoId}`);

        // Only embed changed/new files — unchanged files keep their existing code_chunks rows.
        const allExtractedChunks = [];
        for (const file of pendingFiles) {
          if (!changedFilePaths.has(file.path)) continue;
          if (!file.content) continue;
          const fileChunks = extractChunksFromFile(file.path, file.content, repoId);
          allExtractedChunks.push(...fileChunks);
        }

        console.log(`[indexer] Generated ${allExtractedChunks.length} raw chunks for ${changedFilePaths.size} changed files. Proceeding to OpenAI.`);

        // 10b. Phase 5.2: embedding cache lookup by content hash.
        // Identical chunks across repos (shared library code, copied
        // components) reuse the cached embedding instead of paying OpenAI
        // again. Cache is global by content_hash; access is via service_role.
        console.time(`[indexer] Phase 5: Embedding (${repoId})`);
        const chunksWithHash = allExtractedChunks.map((chunk) => ({
          ...chunk,
          content_hash: sha256(chunk.content),
        }));

        const uniqueHashes = Array.from(new Set(chunksWithHash.map(c => c.content_hash)));
        const cachedEmbeddings = new Map();
        if (uniqueHashes.length > 0) {
          // Look up in batches — Supabase has a URL length cap on `in.()` filters.
          const lookupBatches = chunkArray(uniqueHashes, 500);
          for (const hashBatch of lookupBatches) {
            const { data: cacheRows, error: cacheErr } = await supabaseAdmin
              .from('embedding_cache')
              .select('content_hash, embedding')
              .in('content_hash', hashBatch);
            if (cacheErr) {
              console.warn(`[indexer] embedding_cache lookup failed (continuing without cache): ${cacheErr.message}`);
              break;
            }
            for (const row of (cacheRows || [])) {
              cachedEmbeddings.set(row.content_hash, row.embedding);
            }
          }
        }

        const mappedPayloads = [];
        const newCacheRows = []; // for write-back, dedup'd by content_hash
        const seenNewHashes = new Set();
        const chunksToEmbed = [];
        for (const chunk of chunksWithHash) {
          const cached = cachedEmbeddings.get(chunk.content_hash);
          if (cached) {
            mappedPayloads.push({
              repo_id: chunk.repo_id,
              file_path: chunk.file_path,
              start_line: chunk.start_line,
              end_line: chunk.end_line,
              content: chunk.content,
              embedding: cached,
            });
          } else {
            chunksToEmbed.push(chunk);
          }
        }
        console.log(`[indexer] Embedding cache: ${cachedEmbeddings.size}/${uniqueHashes.length} unique hashes hit (skipping ${allExtractedChunks.length - chunksToEmbed.length} of ${allExtractedChunks.length} chunks).`);

        // Touch last_used_at for cache hits so the eviction job doesn't drop
        // hot rows. Fire-and-forget — failure here doesn't affect correctness,
        // but we must catch rejections to avoid unhandledRejection warnings.
        if (cachedEmbeddings.size > 0) {
          const hitHashes = Array.from(cachedEmbeddings.keys());
          for (const batch of chunkArray(hitHashes, 500)) {
            supabaseAdmin
              .from('embedding_cache')
              .update({ last_used_at: new Date().toISOString() })
              .in('content_hash', batch)
              .then(
                ({ error }) => {
                  if (error) console.warn(`[indexer] embedding_cache touch failed: ${error.message}`);
                },
                (err) => console.warn(`[indexer] embedding_cache touch threw: ${err.message}`),
              );
          }
        }

        const batches = chunkArray(chunksToEmbed, 100);

        // Process embedding batches with concurrency limit of 5
        const embedLimit = pLimit(5);
        await Promise.all(
          batches.map((batch, batchIdx) =>
            embedLimit(async () => {
              try {
                const res = await openai.embeddings.create({
                  input: batch.map(c => c.content),
                  model: "text-embedding-3-small"
                });

                // Record embedding token usage (US-042)
                if (repoUserId && res.usage?.total_tokens) {
                  recordUsage({ userId: repoUserId, endpoint: 'indexer/embed', provider: 'openai', embeddingTokens: res.usage.total_tokens });
                }

                const perChunkTokens = batch.length > 0
                  ? Math.round((res.usage?.total_tokens || 0) / batch.length)
                  : 0;
                for (let i = 0; i < batch.length; i++) {
                  const embedding = res.data[i].embedding;
                  mappedPayloads.push({
                    repo_id: batch[i].repo_id,
                    file_path: batch[i].file_path,
                    start_line: batch[i].start_line,
                    end_line: batch[i].end_line,
                    content: batch[i].content,
                    embedding,
                  });
                  // Phase 5.2: collect a single row per unique content_hash for
                  // write-back to embedding_cache.
                  const hash = batch[i].content_hash;
                  if (hash && !seenNewHashes.has(hash)) {
                    seenNewHashes.add(hash);
                    newCacheRows.push({
                      content_hash: hash,
                      embedding,
                      token_count: perChunkTokens,
                    });
                  }
                }
              } catch (batchErr) {
                console.warn(`[indexer] Batch ${batchIdx} embed failed: ${batchErr.message}. Falling back to per-chunk.`);

                // Per-chunk fallback
                for (const singleChunk of batch) {
                  try {
                    const singleRes = await openai.embeddings.create({
                      input: singleChunk.content,
                      model: "text-embedding-3-small"
                    });
                    const embedding = singleRes.data[0].embedding;
                    mappedPayloads.push({
                      repo_id: singleChunk.repo_id,
                      file_path: singleChunk.file_path,
                      start_line: singleChunk.start_line,
                      end_line: singleChunk.end_line,
                      content: singleChunk.content,
                      embedding,
                    });
                    const hash = singleChunk.content_hash;
                    if (hash && !seenNewHashes.has(hash)) {
                      seenNewHashes.add(hash);
                      newCacheRows.push({
                        content_hash: hash,
                        embedding,
                        token_count: singleRes.usage?.total_tokens || 0,
                      });
                    }
                  } catch (singleErr) {
                    console.warn(`[indexer] Failed to embed chunk in ${singleChunk.file_path}: ${singleErr.message}`);
                  }
                }
              }
            })
          )
        );

        // 10d. Commit bulk inserts correctly against standard JSON array loops mapping matching Schema objects
        if (mappedPayloads.length > 0) {
           const insertBatches = chunkArray(mappedPayloads, 500);
           for (const insBatch of insertBatches) {
             const { error: insErr } = await supabaseAdmin.from('code_chunks').insert(insBatch);
             if (insErr) console.error(`[indexer] DB insert err for vectors: ${insErr.message}`);
           }
        }

        // Phase 5.2: write newly-embedded hashes back to the cache so the next
        // repo that contains the same chunk can skip OpenAI. ON CONFLICT just
        // bumps last_used_at — a race between concurrent indexing runs is a
        // duplicate-key conflict, not an error.
        if (newCacheRows.length > 0) {
          const cacheBatches = chunkArray(newCacheRows, 500);
          for (const cBatch of cacheBatches) {
            const { error: cacheErr } = await supabaseAdmin
              .from('embedding_cache')
              .upsert(
                cBatch.map(r => ({ ...r, last_used_at: new Date().toISOString() })),
                { onConflict: 'content_hash' }
              );
            if (cacheErr) console.warn(`[indexer] embedding_cache writeback failed: ${cacheErr.message}`);
          }
        }
        console.log(`[indexer] Completely finished semantic embeddings mappings. Saved ${mappedPayloads.length} vectors (${newCacheRows.length} new cache rows)!`);
        console.timeEnd(`[indexer] Phase 5: Embedding (${repoId})`);

        try {
          console.time(`[indexer] Phase Duplication (${repoId})`);
          const result = await detectDuplicateCandidates(repoId);
          console.log(`[indexer] Duplication scan saved ${result.inserted || 0} candidate pair(s).`);
          console.timeEnd(`[indexer] Phase Duplication (${repoId})`);
        } catch (duplicationError) {
          console.warn(`[indexer] Duplication scan failed (best-effort): ${duplicationError.message}`);
        }

      } catch (embeddingError) {
        console.warn(`[indexer] Global embedding step failed severely, isolating error entirely: ${embeddingError.message}`);
      }
    }

    console.timeEnd(`[indexer] Total pipeline (${repoId})`);
    console.log(`[indexer] Successfully finished indexing for repoId: ${repoId}`);

    // US-059: kick off Start Here tour generation as fire-and-forget at the very
    // end of the pipeline. By now graph_nodes, graph_edges, and code_chunks all
    // exist so excerpt fallback works. Must not await — failures are logged but
    // never block indexing completion.
    if (repoUserId) {
      setImmediate(() => {
        generateStartHereTour({ repoId, userId: repoUserId }).catch((err) => {
          console.error('[indexer] Start Here tour generation failed:', err.message);
        });
      });
    }

  } catch (error) {
    if (repoId) {
      await supabaseAdmin
        .from('repositories')
        .update({
          status: 'failed'
        })
        .eq('id', repoId);

      // US-077: notify the repo owner that indexing failed (owner only).
      try {
        const { data: repoRow } = await supabaseAdmin
          .from('repositories')
          .select('user_id')
          .eq('id', repoId)
          .maybeSingle();
        if (repoRow?.user_id) {
          await enqueueNotification({
            user_ids: [repoRow.user_id],
            repo_id: repoId,
            type: 'index_failed',
            severity: 'warning',
            payload: { message: error.message || 'Indexing failed' },
            link_url: `/repo/${repoId}`,
          });
        }
      } catch (notifyErr) {
        console.warn('[indexer] index_failed notification emission failed:', notifyErr.message || notifyErr);
      }
    }

    console.error(`[indexer] Failed pipeline for repoId ${repoId}:`, error.message);
  } finally {
    // Remove the zipball temp directory regardless of success/failure so /tmp
    // doesn't fill up with multi-MB extracted repos over repeated re-indexes.
    if (zipTempDir) {
      await fs.rm(zipTempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
};

module.exports = { indexRepository };
