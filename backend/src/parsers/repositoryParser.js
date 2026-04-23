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

  const extensions = ['.js', '.ts', '.jsx', '.tsx'];
  for (const e of extensions) {
    if (allFiles.has(normalizedPath + e)) return normalizedPath + e;
  }

  for (const e of extensions) {
    const indexPath = path.posix.join(normalizedPath, `index${e}`);
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

/**
 * Parse a single file and extract import/dependency edges.
 */
const parseFile = (filePath, source, allFiles = new Set()) => {
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

    const parser = new Parser();
    parser.setLanguage(language);
    const src = typeof source === 'string' ? source : (source == null ? '' : String(source));
    // tree-sitter v0.21.x rejects strings longer than 32767 chars; use callback for large files
    const tree = src.length < 32768
      ? parser.parse(src)
      : parser.parse((i) => i < src.length ? src.slice(i, i + 8192) : null);

    const complexity = calculateComplexity(tree, queryKey);

    const imports = new Set();
    const exports = new Set();

    const query = new Parser.Query(language, queryStr);
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === 'import_path') {
          let rawPath = capture.node.text;
          // Strip surrounding quotes from the string node
          if ((rawPath.startsWith("'") && rawPath.endsWith("'")) ||
              (rawPath.startsWith('"') && rawPath.endsWith('"')) ||
              (rawPath.startsWith('`') && rawPath.endsWith('`'))) {
            rawPath = rawPath.slice(1, -1);
          }
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

    return {
      filePath,
      imports: Array.from(imports),
      exports: Array.from(exports),
      complexity
    };
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
