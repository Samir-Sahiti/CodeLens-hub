const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const TSX = require('tree-sitter-typescript').tsx;
const Python = require('tree-sitter-python');
const CSharp = require('tree-sitter-c-sharp');

const path = require('path');
const { parseGo } = require('./parseGo');
const { parseJava } = require('./parseJava');
const { parseRust } = require('./parseRust');
const { parseRuby } = require('./parseRuby');
const { calculateComplexity } = require('./complexity');

// Reuse one Parser per language — tree-sitter parsers are synchronous and safe
// to reuse in Node's single-threaded event loop, and this avoids re-setting the
// grammar on every file across a large repo.
const parserCache = new Map();
function getParser(language) {
  let p = parserCache.get(language);
  if (!p) {
    p = new Parser();
    p.setLanguage(language);
    parserCache.set(language, p);
  }
  return p;
}

const LANGUAGE_MAP = {
  '.js': JavaScript,
  '.jsx': TSX,
  '.ts': TypeScript,
  '.tsx': TSX,
  '.py': Python,
  '.cs': CSharp,
};

const QUERIES = {
    javascript: `
      ;; ESM Imports: import { x } from "./foo"
      (import_statement (string) @import_path)

      ;; Re-exports: export { x } from "./foo"
      (export_statement (string) @import_path)

      ;; Dynamic imports: import("./foo")
      (call_expression
        (import)
        (arguments (string) @import_path))

      ;; CommonJS require: require("./foo")
      (call_expression
        (identifier) @require_ident (#eq? @require_ident "require")
        (arguments (string) @import_path))

      ;; Named Exports
      (export_statement
        (lexical_declaration (variable_declarator name: (_) @export_name)))
      (export_statement
        (function_declaration name: (_) @export_name))
      (export_statement
        (class_declaration name: (_) @export_name))

      ;; Default Exports
      (export_statement
        value: (_) @export_name)
      (export_statement
        (function_declaration name: (_) @export_name))
      (export_statement
        (class_declaration name: (_) @export_name))
      
      ;; Export list
      (export_specifier name: (_) @export_name)
      (export_specifier alias: (_) @export_name)
    `,
  python: `
    ;; Simple import: import pkg.mod
    (import_statement
      (dotted_name) @import_path)

    ;; From import: from pkg.mod import func
    (import_from_statement
      module_name: (dotted_name) @import_path)

    ;; Relative import: from . import x
    (import_from_statement
      (relative_import) @import_path)

    ;; Class & Function definitions
    (class_definition
      name: (identifier) @export_name)
    (function_definition
      name: (identifier) @export_name)
  `,
  c_sharp: `
    ;; using namespace;
    (using_directive
      [
        (identifier) @import_path
        (qualified_name) @import_path
      ])

    ;; namespace MyApp.Services { ... }
    (namespace_declaration
      name: [
        (identifier) @export_name
        (qualified_name) @export_name
      ])

    ;; Class, Interface, Record, Struct declarations
    (class_declaration
      name: (identifier) @export_name)
    (interface_declaration
      name: (identifier) @export_name)
  `
};

/**
 * Resolves a raw import path to a repository-relative file path.
 */
const resolveImportPath = (importPath, sourceFile, allFiles, ext) => {
  // Python resolution
  if (ext === '.py') {
    // Handle relative imports (e.g., .utils, ..helpers)
    if (importPath.startsWith('.')) {
      let currentDir = path.dirname(sourceFile);
      let dots = 0;
      while (importPath[dots] === '.') {
        dots++;
      }
      
      // Navigate up for each dot beyond the first
      for (let i = 1; i < dots; i++) {
        currentDir = path.dirname(currentDir);
      }
      
      const rest = importPath.substring(dots).replace(/\./g, '/');
      const relPath = rest ? path.posix.join(currentDir, rest) : currentDir;
      
      const candidates = [
        relPath + '.py',
        path.posix.join(relPath, '__init__.py')
      ];
      
      for (const cand of candidates) {
        if (allFiles.has(cand)) return cand;
      }
      return null;
    }

    // Absolute-style import (pkg.mod)
    const parts = importPath.split('.');
    const dotPath = parts.join('/');
    const candidates = [
      dotPath + '.py',
      path.posix.join(dotPath, '__init__.py')
    ];

    for (const cand of candidates) {
      if (allFiles.has(cand)) return cand;
      // Try relative to source file root (first level)
      const relative = path.posix.join(path.dirname(sourceFile), cand);
      if (allFiles.has(relative)) return relative;
    }
    return null;
  }

  // C# resolution
  if (ext === '.cs' && allFiles instanceof Map) {
    // allFiles is the namespaceMap in this context
    return allFiles.get(importPath) || null;
  }

  // JS/TS resolution
  if (!importPath.startsWith('./') && !importPath.startsWith('../')) {
    return null;
  }

  const sourceDir = path.dirname(sourceFile);
  const absoluteRepoPath = path.posix.join(sourceDir, importPath);
  const normalizedPath = path.posix.normalize(absoluteRepoPath);

  if (allFiles.has(normalizedPath)) return normalizedPath;

  const extensions = ['.tsx', '.ts', '.jsx', '.js'];
  for (const e of extensions) {
    if (allFiles.has(normalizedPath + e)) return normalizedPath + e;
  }

  const INDEX_PRIORITY = [
    "index.tsx",
    "index.ts",
    "index.js"
  ];

  for (const indexFile of INDEX_PRIORITY) {
    const indexPath = path.posix.join(normalizedPath, indexFile);
    if (allFiles.has(indexPath)) return indexPath;
  }

  return null;
};

const getLanguageKey = (ext) => {
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return 'javascript';
  if (ext === '.py') return 'python';
  if (ext === '.cs') return 'c_sharp';
  return null;
};

// US-064: collect all import_statement nodes so we can extract per-import
// symbol lists for the graph_edges.symbols column.
const collectImportStatements = (node, out) => {
  if (node.type === 'import_statement') {
    out.push(node);
    return; // imports do not nest
  }
  for (const child of node.namedChildren) {
    collectImportStatements(child, out);
  }
};

const unquote = (text) => {
  if (typeof text !== 'string' || text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  if ((first === "'" && last === "'") || (first === '"' && last === '"') || (first === '`' && last === '`')) {
    return text.slice(1, -1);
  }
  return text;
};

// Pulls the imported symbol names from a JS/TS import_statement node.
// Returns the local-binding name for each specifier — the alias if present,
// otherwise the original name — so the resulting list reflects what the
// importing file actually references.
const extractImportInfo = (importStmt) => {
  let rawPath = null;
  const symbols = [];
  for (const child of importStmt.namedChildren) {
    if (child.type === 'string') {
      rawPath = unquote(child.text);
    } else if (child.type === 'import_clause') {
      for (const sub of child.namedChildren) {
        if (sub.type === 'identifier') {
          symbols.push(sub.text);
        } else if (sub.type === 'namespace_import') {
          for (const idChild of sub.namedChildren) {
            if (idChild.type === 'identifier') symbols.push(idChild.text);
          }
        } else if (sub.type === 'named_imports') {
          for (const spec of sub.namedChildren) {
            if (spec.type !== 'import_specifier') continue;
            let chosen = null;
            if (typeof spec.childForFieldName === 'function') {
              const alias = spec.childForFieldName('alias');
              const name = spec.childForFieldName('name');
              chosen = (alias && alias.text) || (name && name.text) || null;
            }
            if (!chosen) {
              const ids = spec.namedChildren.filter((c) => c.type === 'identifier' || c.type === 'property_identifier');
              if (ids.length > 0) chosen = ids[ids.length - 1].text;
            }
            if (chosen) symbols.push(chosen);
          }
        }
      }
    }
  }
  return { rawPath, symbols };
};

/**
 * Parse a single file and extract import/dependency edges.
 */
const parseFile = (filePath, source, allFiles = new Set(), opts = {}) => {
  try {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.go') return parseGo(filePath, source, allFiles);
    if (ext === '.java') return parseJava(filePath, source, allFiles);
    if (ext === '.rs') return parseRust(filePath, source, allFiles);
    if (ext === '.rb') return parseRuby(filePath, source, allFiles);

    const language = LANGUAGE_MAP[ext];
    const queryKey = getLanguageKey(ext);
    const queryStr = QUERIES[queryKey];

    if (!language || !queryStr) return { filePath, imports: [], exports: [] };

    const parser = getParser(language);
    const src = typeof source === 'string' ? source : (source == null ? '' : String(source));
    // Phase 5.3: when a cached tree is supplied (e.g. C# pre-pass result), skip
    // re-parsing. Tree-sitter parse is the dominant cost; re-running the query
    // against an existing tree is essentially free.
    const tree = opts.cachedTree
      || (src.length < 32768
        ? parser.parse(src)
        : parser.parse((i) => i < src.length ? src.slice(i, i + 8192) : null));

    const complexity = opts.cachedComplexity != null
      ? opts.cachedComplexity
      : calculateComplexity(tree, queryKey);

    const imports = new Set();
    const exports = new Set();

    const query = new Parser.Query(language, queryStr);
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === 'import_path') {
          const rawPath = unquote(capture.node.text);
          const resolved = resolveImportPath(rawPath, filePath, allFiles, ext);
          if (resolved) {
            if (Array.isArray(resolved)) {
              resolved.forEach(r => imports.add(r));
            } else {
              imports.add(resolved);
            }
          }
        } else if (capture.name === 'export_name') {
          exports.add(capture.node.text);
        }
      }
    }

    // US-064: build a per-importer symbol map for JS/TS. The tree-sitter Query
    // path above already collected the file-level imports; this second walk
    // attaches each statement's specifier names to the resolved target path.
    const importSymbols = {};
    if (queryKey === 'javascript') {
      const importStmts = [];
      collectImportStatements(tree.rootNode, importStmts);
      for (const stmt of importStmts) {
        const { rawPath, symbols } = extractImportInfo(stmt);
        if (!rawPath || symbols.length === 0) continue;
        const resolved = resolveImportPath(rawPath, filePath, allFiles, ext);
        if (!resolved) continue;
        const paths = Array.isArray(resolved) ? resolved : [resolved];
        for (const p of paths) {
          if (!importSymbols[p]) importSymbols[p] = [];
          for (const sym of symbols) {
            if (!importSymbols[p].includes(sym)) importSymbols[p].push(sym);
          }
        }
      }
    }

    const result = {
      filePath,
      imports: Array.from(imports),
      exports: Array.from(exports),
      complexity,
      importSymbols,
    };
    // Non-enumerable so JSON.stringify / structuredClone don't try to ship the
    // tree-sitter tree object. Consumers that want it for caching read it
    // directly (Phase 5.3 — C# pre-pass → main pass dedupe).
    Object.defineProperty(result, '_tree', { value: tree, enumerable: false });
    return result;
  } catch (err) {
    console.warn(`[Parser] Failed to parse ${filePath}: ${err.message}`);
    return { filePath, imports: [], exports: [], complexity: 1 };
  }
};

const parseRepository = (files) => {
  const allFilesSet = new Set(files.map(f => f.path));
  const nodes = [];
  const edges = [];

  for (const file of files) {
    const { imports, exports, complexity } = parseFile(file.path, file.content, allFilesSet);
    nodes.push({ path: file.path, exports, complexity });
    for (const imp of imports) {
      edges.push({ from: file.path, to: imp });
    }
  }

  return { nodes, edges };
};

module.exports = { parseFile, parseRepository };
