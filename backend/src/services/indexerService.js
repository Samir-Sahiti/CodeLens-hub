const { parseFile } = require('../parsers/repositoryParser');
const { extractChunksFromFile } = require('../parsers/chunkParser');
const { scanFileForSecrets } = require('./secretScanner');
const { scanFileForInsecurePatterns } = require('./sastEngine'); // US-046
const { recordUsage } = require('./usageTracker'); // US-042
const { isManifestFile, parseManifest } = require('./manifestParser'); // US-045
const { scanDependencies } = require('./osvScanner'); // US-045
const { OpenAI } = require('openai');
const { supabaseAdmin } = require('../db/supabase');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'sk-dummy' });
const { Octokit } = require('octokit');
const pLimit = require('p-limit');
const fs = require('fs/promises');
const path = require('path');

const VALID_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.cs', '.go', '.java', '.rs', '.rb']);

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function fetchGithubFiles(owner, name, token) {
  const octokit = new Octokit({ auth: token });
  let treeSha;
  try {
    const { data: commit } = await octokit.rest.repos.getCommit({
      owner,
      repo: name,
      ref: 'HEAD',
    });
    treeSha = commit.commit.tree.sha;
  } catch (err) {
    if (err.status === 404) {
      throw new Error(`GitHub repository '${owner}/${name}' not found or insufficient OAuth permissions. (Ensure 'repo' scope is granted in Supabase/GitHub)`);
    }
    throw err;
  }

  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo: name,
    tree_sha: treeSha,
    recursive: '1',
  });

  const sourceFiles   = [];
  const manifestFiles = [];

  for (const item of tree.tree) {
    if (item.type !== 'blob') continue;
    if (VALID_EXTENSIONS.has(path.extname(item.path).toLowerCase())) {
      sourceFiles.push({ path: item.path, sha: item.sha, content: null });
    } else if (isManifestFile(item.path)) {
      manifestFiles.push({ path: item.path, sha: item.sha, content: null });
    }
  }

  return { sourceFiles, manifestFiles };
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

async function getGithubFileContent(octokit, owner, name, sha) {
  const { data: blob } = await octokit.rest.git.getBlob({
    owner, repo: name, file_sha: sha
  });
  return Buffer.from(blob.content, blob.encoding).toString('utf-8');
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
  try {
    console.log(`[indexer] Starting indexing for repoId: ${repoId} (source: ${source})`);
    console.time(`[indexer] Total pipeline (${repoId})`);

    // Clear all derived tables in a single DB round trip via RPC instead of 6
    // separate PostgREST calls.  The function runs all DELETEs in one transaction,
    // avoiding repeated FK lock acquisitions on the repositories parent row.
    const { error: clearError } = await supabaseAdmin.rpc('clear_repo_derived_data', { p_repo_id: repoId });
    if (clearError) {
      console.warn(`[indexer] Failed clearing derived data before reindex: ${clearError.message}`);
    }

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
    if (source === 'github') {
      // Single tree fetch returns both source files and manifest files (US-045)
      const { sourceFiles, manifestFiles: githubManifests } = await fetchGithubFiles(owner, name, token);
      pendingFiles = sourceFiles;
      manifestFiles.push(...githubManifests);
    } else if (source === 'upload') {
      pendingFiles = await fetchLocalFiles(extractPath);
    }

    const getAllFilesSet = new Set(pendingFiles.map(f => f.path));
    console.timeEnd(`[indexer] Phase 1: File discovery (${repoId})`);
    console.log(`[indexer] Discovered ${pendingFiles.length} files to index.`);

    // US-045: For upload source, scan filesystem for manifest files
    if (source === 'upload') {
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
      await scanForManifests(extractPath, extractPath);
      console.timeEnd(`[indexer] Phase 1b: Manifest discovery (${repoId})`);
    }

    console.log(`[indexer] Discovered ${manifestFiles.length} manifest file(s) for SCA.`);

    // octokit instance for github fetching inside pLimit
    const octokit = source === 'github' ? new Octokit({ auth: token }) : null;

    const limit = pLimit(10);
    const issues = [];

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
    const isCSharpRepo = pendingFiles.some(f => f.path.toLowerCase().endsWith('.cs'));

    if (isCSharpRepo) {
      console.log(`[indexer] C# files detected. Running namespace pre-pass...`);
      await Promise.all(
        pendingFiles.map(file =>
          limit(async () => {
            if (!file.path.toLowerCase().endsWith('.cs')) return;
            try {
              if (source === 'github') {
                file.content = await getGithubFileContent(octokit, owner, name, file.sha);
              } else {
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
    console.time(`[indexer] Phase 2: Parsing (${repoId})`);
    await Promise.all(
      pendingFiles.map(file =>
        limit(async () => {
          try {
            // Content might already be loaded from pre-pass
            if (!file.content) {
              if (source === 'github') {
                file.content = await getGithubFileContent(octokit, owner, name, file.sha);
              } else {
                file.content = await fs.readFile(file.fsPath, 'utf-8');
              }
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
    const nodeMap = new Map();
    const allEdges = [];
    let fileCount = pendingFiles.length; // From acceptance criteria or just matched valid files

    for (const file of parsedFiles) {
      if (!file) continue; // In case of skipped parse

      // Find original file body to count lines
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
        complexity_score: file.complexity || 1
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
    const uniqueNodes = Array.from(nodeMap.values());

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

    const totalNodes = uniqueNodes.length || 1; // avoid / 0

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

    // Circular dependency detection
    const adjacencyList = new Map();
    for (const edge of uniqueEdges) {
      if (!adjacencyList.has(edge.from_path)) adjacencyList.set(edge.from_path, []);
      adjacencyList.get(edge.from_path).push(edge.to_path);
    }

    const visited = new Set();
    const recStack = new Set();
    const cycles = [];

    const detectCycle = (node, pathArr) => {
      visited.add(node);
      recStack.add(node);
      pathArr.push(node);

      const neighbors = adjacencyList.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          detectCycle(neighbor, pathArr);
        } else if (recStack.has(neighbor)) {
          // cycle detected
          const startIdx = pathArr.indexOf(neighbor);
          const cyclePaths = pathArr.slice(startIdx);
          cycles.push(cyclePaths);
        }
      }

      pathArr.pop();
      recStack.delete(node);
    };

    for (const node of nodeMap.keys()) {
      if (!visited.has(node)) {
        detectCycle(node, []);
      }
    }

    // Issue: Circular Dependency
    if (cycles.length > 0) {
      // Create issue for the first few cycles to avoid massive spam
      for (const cycle of cycles.slice(0, 10)) {
        issues.push({
          repo_id: repoId,
          type: 'circular_dependency',
          severity: 'high',
          file_paths: cycle,
          description: 'A circular dependency cycle was detected.'
        });
      }
    }

    // Issue: God file & High coupling & Dead code
    for (const node of finalNodes) {
      // God file
      // A god file typically has a high cyclomatic complexity and large line count
      const godCondition1 = node.incoming_count >= 10 && node.incoming_count > (totalNodes * 0.3);
      const godCondition2 = node.complexity_score > 30 || (node.line_count > 500 && node.incoming_count > (totalNodes * 0.1));
      if (godCondition1 || godCondition2) {
        issues.push({
          repo_id: repoId,
          type: 'god_file',
          severity: (godCondition1 && godCondition2) ? 'high' : 'medium',
          file_paths: [node.file_path],
          description: `This file is overly complex (Score: ${node.complexity_score}) or heavily imported — changes here have a wide blast radius.`
        });
      }

      // High coupling
      if (node.outgoing_count > 15) {
        let severity = 'low';
        if (node.outgoing_count >= 30) severity = 'high';
        else if (node.outgoing_count >= 20) severity = 'medium';

        issues.push({
          repo_id: repoId,
          type: 'high_coupling',
          severity,
          file_paths: [node.file_path],
          description: `This file imports ${node.outgoing_count} other files — it may be doing too much and is difficult to test or refactor.`
        });
      }

      // Dead code
      if (node.incoming_count === 0 && node.language !== 'c_sharp') {
        const lowerPath = node.file_path.toLowerCase();
        const isEntryPoint = lowerPath.endsWith('index.js') || lowerPath.endsWith('main.py') || lowerPath.endsWith('program.cs') || lowerPath.endsWith('app.js') || lowerPath.endsWith('server.js') || lowerPath.endsWith('index.ts') || lowerPath.endsWith('app.tsx');
        if (!isEntryPoint && !node.file_path.includes('.test.') && !node.file_path.includes('.spec.')) {
           issues.push({
            repo_id: repoId,
            type: 'dead_code',
            severity: 'low',
            file_paths: [node.file_path],
            description: `No other files import this file — it may be unused.`
          });
        }
      }
    }

    // US-045: Dependency vulnerability scanning (SCA) — best-effort, never blocks pipeline
    try {
      if (manifestFiles.length > 0) {
        console.time(`[indexer] Phase SCA: Dependency scanning (${repoId})`);

        const manifestOctokit = source === 'github' ? new Octokit({ auth: token }) : null;
        const allDeps = [];

        for (const mf of manifestFiles) {
          try {
            if (source === 'github') {
              mf.content = await getGithubFileContent(manifestOctokit, owner, name, mf.sha);
            } else {
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
            await supabaseAdmin.from('dependency_manifests').delete().eq('repo_id', repoId);

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

    if (issues.length > 0) {
      const issueChunks = chunkArray(issues, 500);
      for (const chunk of issueChunks) {
        const { error } = await supabaseAdmin.from('analysis_issues').insert(chunk);
        if (error) console.error(`[indexer] Database error inserting issues: ${error.message}`);
      }
    }

    // 10. Store full file contents (US-043) — independent of OpenAI key
    await supabaseAdmin.from('file_contents').delete().eq('repo_id', repoId);
    const FILE_SIZE_CAP = 1024 * 1024; // 1 MB
    const fileContentRows = [];
    for (const file of pendingFiles) {
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
    } else {
      try {
        console.log(`[indexer] Starting semantic chunking and embedding for ${repoId}`);

        // Wipe obsolete chunks before re-embedding
        await supabaseAdmin.from('code_chunks').delete().eq('repo_id', repoId);

        // Extract local raw chunks
        const allExtractedChunks = [];
        for (const file of pendingFiles) {
          if (!file.content) continue;
          const fileChunks = extractChunksFromFile(file.path, file.content, repoId);
          allExtractedChunks.push(...fileChunks);
        }

        console.log(`[indexer] Generated ${allExtractedChunks.length} raw chunks. Proceeding to OpenAI.`);

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

      } catch (embeddingError) {
        console.warn(`[indexer] Global embedding step failed severely, isolating error entirely: ${embeddingError.message}`);
      }
    }

    // 11. update repo (ready)
    await supabaseAdmin
      .from('repositories')
      .update({
        status: 'ready',
        indexed_at: new Date().toISOString(),
        file_count: fileCount
      })
      .eq('id', repoId);

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
  }
};

module.exports = { indexRepository };
