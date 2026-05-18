/**
 * Singleton Piscina pool for tree-sitter parsing (Phase 5.1).
 *
 * Node is single-threaded; tree-sitter parsing is CPU-bound and synchronous,
 * so even `pLimit(10)` only buys I/O overlap. Off-loading parse work to a
 * worker pool lets the indexer use multiple cores on multi-core hosts.
 *
 * Env knobs:
 *   PARSER_WORKERS_DISABLED  truthy → skip the pool entirely and call parseFile
 *                            in-process (CI, debug, and parser unit tests).
 *   PARSER_WORKER_COUNT      override worker count (default: os.cpus().length,
 *                            capped at 8 — Piscina's diminishing-returns knee).
 *
 * Public API:
 *   getParserPool()        → Piscina instance or null when disabled
 *   parseFileInPool(args)  → Promise<parsed> with in-process fallback
 *   shutdownParserPool()   → graceful close (mostly for tests)
 */

const path = require('path');
const os = require('os');
const { parseFile: parseFileInProcess } = require('./repositoryParser');

let pool = null;
let workersDisabled = null;

function isDisabled() {
  if (workersDisabled !== null) return workersDisabled;
  const raw = String(process.env.PARSER_WORKERS_DISABLED || '').toLowerCase();
  workersDisabled = raw === '1' || raw === 'true' || raw === 'yes';
  return workersDisabled;
}

function getParserPool() {
  if (isDisabled()) return null;
  if (pool) return pool;
  try {
    // Lazy-require so environments without piscina installed (or which set
    // PARSER_WORKERS_DISABLED) don't pay the cost.
    // Piscina v3 exported the class as `module.exports`; v4 exposes it as a
    // named export with CJS interop (and may use a `default` field under
    // some bundlers). Accept whichever shape the installed version provides.
    const piscinaExport = require('piscina');
    const Piscina = piscinaExport.Piscina || piscinaExport.default || piscinaExport;
    if (typeof Piscina !== 'function') {
      throw new Error('Piscina constructor not found in module exports');
    }
    const cpuCount = Math.max(1, os.cpus().length);
    const desired = parseInt(process.env.PARSER_WORKER_COUNT || '', 10);
    const maxThreads = Number.isFinite(desired) && desired > 0
      ? desired
      : Math.min(cpuCount, 8);

    pool = new Piscina({
      filename: path.resolve(__dirname, 'parser-worker.js'),
      maxThreads,
      // idleTimeout keeps workers warm during an indexing run (tree-sitter
      // native module load is non-trivial) but lets them spin down later.
      idleTimeout: 60_000,
    });
    return pool;
  } catch (err) {
    console.warn(`[parserPool] Piscina unavailable, falling back to in-process parsing: ${err.message}`);
    workersDisabled = true;
    return null;
  }
}

/**
 * Parse a file via the worker pool when available; fall back to in-process
 * parsing on disable/error so a misconfigured worker can never break indexing.
 */
async function parseFileInPool({ filePath, content, allFiles, namespaceMap }) {
  const activePool = getParserPool();
  if (!activePool) {
    return parseFileInProcess(filePath, content, namespaceMap || allFiles || new Set());
  }
  try {
    return await activePool.run({
      filePath,
      content,
      allFiles: Array.isArray(allFiles)
        ? allFiles
        : (allFiles instanceof Set ? Array.from(allFiles) : null),
      namespaceMap: namespaceMap instanceof Map
        ? Array.from(namespaceMap.entries())
        : (Array.isArray(namespaceMap) ? namespaceMap : null),
    });
  } catch (err) {
    console.warn(`[parserPool] Worker parse failed for ${filePath} (${err.message}); falling back in-process`);
    return parseFileInProcess(filePath, content, namespaceMap || allFiles || new Set());
  }
}

async function shutdownParserPool() {
  if (!pool) return;
  try { await pool.destroy(); } catch { /* ignore */ }
  pool = null;
}

module.exports = { getParserPool, parseFileInPool, shutdownParserPool };
