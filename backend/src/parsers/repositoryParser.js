const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const Python = require('tree-sitter-python');
const CSharp = require('tree-sitter-c-sharp');

const path = require('path');

const LANGUAGE_MAP = {
  '.js': JavaScript,
  '.jsx': JavaScript,
  '.ts': TypeScript,
  '.tsx': TypeScript,
  '.py': Python,
  '.cs': CSharp,
};

const QUERIES = {
  javascript: `
    ;; ESM Imports
    (import_statement
      source: (string (string_fragment) @import_path))

    ;; Re-exports
    (export_statement
      source: (string (string_fragment) @import_path))

    ;; Dynamic imports
    (call_expression
      function: (import)
      arguments: (arguments (string (string_fragment) @import_path)))

    ;; CommonJS require
    (call_expression
      function: (identifier) @func_name (#eq? @func_name "require")
      arguments: (arguments (string (string_fragment) @import_path)))

    ;; Named Exports (e.g., export const x = 1)
    (export_statement
      declaration: [
        (lexical_declaration (variable_declarator name: (identifier) @export_name))
        (function_declaration name: (identifier) @export_name)
        (class_declaration name: (identifier) @export_name)
      ])

    ;; Default Exports (simplified)
    (export_statement
      value: (identifier) @export_name)
    
    ;; Export list (e.g., export { x, y })
    (export_statement
      (export_clause (export_specifier (identifier) @export_name)))
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
    const language = LANGUAGE_MAP[ext];
    const queryKey = getLanguageKey(ext);
    const queryStr = QUERIES[queryKey];

    if (!language || !queryStr) return { filePath, imports: [], exports: [] };

    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(source);

    const imports = new Set();
    const exports = new Set();

    const query = new Parser.Query(language, queryStr);
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === 'import_path') {
          const rawPath = capture.node.text;
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
      exports: Array.from(exports)
    };
  } catch (err) {
    console.warn(`[Parser] Failed to parse ${filePath}: ${err.message}`);
    return { filePath, imports: [], exports: [] };
  }
};

const parseRepository = (files) => {
  const allFilesSet = new Set(files.map(f => f.path));
  const nodes = [];
  const edges = [];

  for (const file of files) {
    const { imports, exports } = parseFile(file.path, file.content, allFilesSet);
    nodes.push({ path: file.path, exports });
    for (const imp of imports) {
      edges.push({ from: file.path, to: imp });
    }
  }

  return { nodes, edges };
};

module.exports = { parseFile, parseRepository };
