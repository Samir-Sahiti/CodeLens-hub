/**
 * Tree-sitter parser worker (Phase 5.1).
 *
 * Piscina spins up one of these per CPU core. Tree-sitter native modules are
 * loaded once per worker at module load (acceptable: the pool is long-lived)
 * so the per-file cost is just `parser.parse()` + query matching.
 *
 * Input:  { filePath, content, allFiles? (Array<string>), namespaceMap? (Array<[string,string[]]>) }
 * Output: same shape as parseFile() — { filePath, imports, exports, complexity, importSymbols }
 *
 * Structured clone supports Map/Set but Piscina recommends transferring plain
 * objects, so callers serialise sets/maps to arrays and the worker rehydrates.
 */

const { parseFile } = require('./repositoryParser');

module.exports = function parseFileTask({ filePath, content, allFiles, namespaceMap }) {
  let context;
  if (Array.isArray(namespaceMap)) {
    context = new Map(namespaceMap);
  } else if (Array.isArray(allFiles)) {
    context = new Set(allFiles);
  } else {
    context = new Set();
  }
  const parsed = parseFile(filePath, content, context);
  // Explicitly project to JSON-safe fields. parseFile stashes the tree-sitter
  // `_tree` as a non-enumerable own property for in-process re-use; structured
  // clone is supposed to skip non-enumerable props, but native tree objects
  // would throw DataCloneError if the algorithm ever accesses them — return
  // a fresh plain object so the worker boundary stays bulletproof.
  return {
    filePath: parsed.filePath,
    imports: parsed.imports || [],
    exports: parsed.exports || [],
    complexity: parsed.complexity != null ? parsed.complexity : 1,
    importSymbols: parsed.importSymbols || {},
  };
};
