const { parseFile } = require('../parsers/repositoryParser');
const { extractChunksFromFile } = require('../parsers/chunkParser');
const { detectIssues } = require('./issueDetection');
const { scanFileForSecrets } = require('./secretScanner');
const { scanFileForInsecurePatterns } = require('./sastEngine'); // US-046
const { scanFileForMissingAuth } = require('./authCoverageScanner'); // US-049
const { classifyFile } = require('./attackSurfaceClassifier'); // US-047
const { fetchRepoChurn } = require('./churnService'); // US-050
const { detectDuplicateCandidates } = require('./duplicationScanner'); // US-052
const { isTestFilePath, parseCoverageOverrides } = require('./testCoverageService'); // US-053
const { recordUsage } = require('./usageTracker'); // US-042
const { isManifestFile, parseManifest } = require('./manifestParser'); // US-045
const { scanDependencies } = require('./osvScanner'); // US-045
const { OpenAI } = require('openai');
const { supabaseAdmin } = require('../db/supabase');
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

async function markRepoReady({ repoId, fileCount, hasCoverageFiles, finalNodes }) {
  await supabaseAdmin
    .from('repositories')
    .update({
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
    })
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

function toAnalysisIssueInsert(issue, repoId) {
  return {
    id: crypto.randomUUID(),
    repo_id: issue.repo_id || repoId,
    type: issue.type,
    severity: issue.severity,
    file_paths: Array.isArray(issue.file_paths) ? issue.file_paths : [],
    description: issue.description || null,
  };
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
const indexRepository = async ({ repoId, owner, name, token, extractPath, source }) => {
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
      .eq('repo_id', repoId);
    const existingNodeMap = new Map((existingNodeRows || []).map(n => [n.file_path, n]));

    // Also pre-fetch existing edges for unchanged files (we'll reuse them to skip re-parsing imports)
    const { data: existingEdgeRows } = await supabaseAdmin
      .from('graph_edges')
      .select('from_path, to_path')
      .eq('repo_id', repoId);

    // Fetch repo owner for usage tracking (US-042)
    const { data: repoMeta } = await supabaseAdmin
      .from('repositories')
      .select('user_id')
      .eq('id', repoId)
      .single();
    const repoUserId = repoMeta?.user_id || null;

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

    // ── Targeted clearing instead of blanket wipe ─────────────────────────────
    // Pre-fetch per-file issues (secrets + SAST) for unchanged files before clearing.
    // We skip scanning unchanged files so we need to re-inject their existing issues.
    const PER_FILE_ISSUE_TYPES = ['hardcoded_secret', 'insecure_pattern'];
    let preservedPerFileIssues = [];
    if (unchangedFilePaths.size > 0) {
      const unchangedArr = [...unchangedFilePaths];
      const batches = chunkArray(unchangedArr, 150);
      for (const batch of batches) {
        const { data: existing } = await supabaseAdmin
          .from('analysis_issues')
          .select('*')
          .eq('repo_id', repoId)
          .in('type', PER_FILE_ISSUE_TYPES)
          .overlaps('file_paths', batch);
        if (existing) preservedPerFileIssues.push(...existing);
      }
    }

    // Always clear: issues, dependency_manifests, all edges (coupling counts change)
    // Partial clear: nodes/chunks/file_contents only for changed or deleted files
    await supabaseAdmin.from('analysis_issues').delete().eq('repo_id', repoId);
    await supabaseAdmin.from('dependency_manifests').delete().eq('repo_id', repoId);
    await supabaseAdmin.from('graph_edges').delete().eq('repo_id', repoId);
    await supabaseAdmin.from('file_churn').delete().eq('repo_id', repoId); // US-050
    await supabaseAdmin.from('duplication_candidates').delete().eq('repo_id', repoId); // US-052
    await supabaseAdmin
      .from('graph_nodes')
      .update({ has_test_coverage: false, coverage_percentage: null, is_test_file: false })
      .eq('repo_id', repoId);

    if (changedOrDeletedPaths.length > 0) {
      const pathBatches = chunkArray(changedOrDeletedPaths, 150);
      for (const batch of pathBatches) {
        await supabaseAdmin.from('graph_nodes').delete().eq('repo_id', repoId).in('file_path', batch);
        await supabaseAdmin.from('code_chunks').delete().eq('repo_id', repoId).in('file_path', batch);
        await supabaseAdmin.from('file_contents').delete().eq('repo_id', repoId).in('file_path', batch);
      }
    }

    const limit = pLimit(10);
    // Seed with pre-fetched per-file issues from unchanged files (secrets + SAST)
    const issues = [...preservedPerFileIssues];

    // Fetch existing suppressions for this repo BEFORE scanning
    const { data: suppressions } = await supabaseAdmin
      .from('issue_suppressions')
      .select('file_path, rule_id, line_number')
      .eq('repo_id', repoId);
    const suppSet = new Set(suppressions?.map(s => `${s.file_path}:${s.rule_id}:${s.line_number}`) || []);

    // Fetch sast_disabled_rules for this repo (US-046)
    const { data: repoConfig } = await supabaseAdmin
      .from('repositories')
      .select('sast_disabled_rules')
      .eq('id', repoId)
      .single();
    const disabledSastRules = repoConfig?.sast_disabled_rules || [];

    // 2.5 Optional Pre-pass for C# Namespaces (US-011)
    const namespaceMap = new Map();
    // Files that need to be parsed (changed or new) — defined here for use by pre-pass and parsing phase
    const filesToProcess = pendingFiles.filter(f => changedFilePaths.has(f.path));

    const isCSharpRepo = pendingFiles.some(f => f.path.toLowerCase().endsWith('.cs'));

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
              const parsed = parseFile(file.path, file.content, getAllFilesSet);
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
            // Parse file directly, passing namespaceMap for C# resolution
            const parsed = parseFile(file.path, file.content, isCSharpRepo ? namespaceMap : getAllFilesSet);
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

    // Reconstruct edges originating from unchanged files
    for (const edge of (existingEdgeRows || [])) {
      if (unchangedFilePaths.has(edge.from_path)) {
        allEdges.push({ repo_id: repoId, from_path: edge.from_path, to_path: edge.to_path });
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

      for (const imp of file.imports) {
        // Create edges correctly
        allEdges.push({
          repo_id: repoId,
          from_path: file.filePath,
          to_path: imp
        });
      }
    }

    // Dedupe edges in memory
    const edgeMap = new Map();
    for (const edge of allEdges) {
      const edgeKey = `${edge.from_path}->${edge.to_path}`;
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, edge);
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

    // 6. bulk insert nodes
    console.time(`[indexer] Phase 3: DB writes (${repoId})`);
    const nodeChunks = chunkArray(uniqueNodes, 500);
    for (const chunk of nodeChunks) {
      const { error } = await supabaseAdmin
        .from('graph_nodes')
        .upsert(chunk, { onConflict: 'repo_id,file_path', ignoreDuplicates: true });
      if (error) throw new Error(`Database error inserting nodes: ${error.message}`);
    }

    // 7. bulk insert edges
    const edgeChunks = chunkArray(uniqueEdges, 500);
    for (const chunk of edgeChunks) {
      const { error } = await supabaseAdmin
        .from('graph_edges')
        .upsert(chunk, { onConflict: 'repo_id,from_path,to_path', ignoreDuplicates: true });
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
      const { error } = await supabaseAdmin
        .from('graph_nodes')
        .upsert(chunk, { onConflict: 'repo_id,file_path', ignoreDuplicates: false }); // false to DO UPDATE
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

    await supabaseAdmin
      .from('analysis_issues')
      .delete()
      .eq('repo_id', repoId)
      .eq('type', 'untested_critical_file');

    if (issues.length > 0) {
      const issueRows = issues
        .filter(issue => issue?.type && Array.isArray(issue.file_paths) && issue.file_paths.length > 0)
        .map(issue => toAnalysisIssueInsert(issue, repoId));
      const issueChunks = chunkArray(issueRows, 500);
      for (const chunk of issueChunks) {
        const { error } = await supabaseAdmin.from('analysis_issues').insert(chunk);
        if (error) console.error(`[indexer] Database error inserting issues: ${error.message}`);
      }
    }

    // Core analysis is now usable. Mark the repo ready before slower best-effort
    // enrichment so the UI does not stay on the loading skeleton while optional
    // chunking, duplicate detection, or churn work finishes.
    await markRepoReady({ repoId, fileCount, hasCoverageFiles, finalNodes });

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
        const { error: fcErr } = await supabaseAdmin
          .from('file_contents')
          .upsert(batch, { onConflict: 'repo_id,file_path', ignoreDuplicates: false });
        if (fcErr) console.error(`[indexer] file_contents insert error: ${fcErr.message}`);
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

        // 10c. Batch API vectors — batch size of 100 (OpenAI supports up to 2048 inputs)
        console.time(`[indexer] Phase 5: Embedding (${repoId})`);
        const batches = chunkArray(allExtractedChunks, 100);
        const mappedPayloads = [];

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

                for (let i = 0; i < batch.length; i++) {
                  mappedPayloads.push({
                    repo_id: batch[i].repo_id,
                    file_path: batch[i].file_path,
                    start_line: batch[i].start_line,
                    end_line: batch[i].end_line,
                    content: batch[i].content,
                    embedding: res.data[i].embedding
                  });
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
                    mappedPayloads.push({
                      repo_id: singleChunk.repo_id,
                      file_path: singleChunk.file_path,
                      start_line: singleChunk.start_line,
                      end_line: singleChunk.end_line,
                      content: singleChunk.content,
                      embedding: singleRes.data[0].embedding
                    });
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
        console.log(`[indexer] Completely finished semantic embeddings mappings. Saved ${mappedPayloads.length} vectors!`);
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

    // US-050: Git history hotspots — GitHub repos only, best-effort
    if (source === 'github' && token) {
      try {
        console.time(`[indexer] Phase Churn (${repoId})`);
        const churnMap = await fetchRepoChurn(owner, name, token, repoId);

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
            const rfIssues = top10.map(({ filePath, entry, complexity, score }) => ({
              repo_id: repoId,
              type: 'refactoring_candidate',
              severity: score > 0.5 ? 'high' : 'medium',
              file_paths: [filePath],
              description: `Hotspot score ${(score * 100).toFixed(0)}/100 — ${entry.count} commits in 12 months by ${entry.authors.size} author${entry.authors.size !== 1 ? 's' : ''}, ${entry.lines.toLocaleString()} lines changed, cyclomatic complexity ${complexity.toFixed(1)}.`,
            }));
            const { error: rfErr } = await supabaseAdmin.from('analysis_issues').insert(rfIssues);
            if (rfErr) console.warn(`[indexer] refactoring_candidate insert error: ${rfErr.message}`);
          }
        }
        console.timeEnd(`[indexer] Phase Churn (${repoId})`);
      } catch (churnErr) {
        console.warn(`[indexer] Churn analysis failed (best-effort, non-blocking): ${churnErr.message}`);
      }
    }

    console.timeEnd(`[indexer] Total pipeline (${repoId})`);
    console.log(`[indexer] Successfully finished indexing for repoId: ${repoId}`);

  } catch (error) {
    if (repoId) {
      await supabaseAdmin
        .from('repositories')
        .update({
          status: 'failed'
        })
        .eq('id', repoId);
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
