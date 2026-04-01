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
};

/**
 * Resolves a raw import path to a repository-relative file path.
 * 
 * @param {string} importPath - The raw path from the import/require statement (e.g., './utils')
 * @param {string} sourceFile - The repo-relative path of the file containing the import (e.g., 'src/index.js')
 * @param {Set<string>} allFiles - A Set of all repo-relative file paths in the repository
 * @returns {string|null} - The resolved repo-relative path, or null if it cannot be resolved as a local file
 */
const resolveImportPath = (importPath, sourceFile, allFiles) => {
  // 1. Only resolve relative paths
  if (!importPath.startsWith('./') && !importPath.startsWith('../')) {
    return null;
  }

  const sourceDir = path.dirname(sourceFile);
  const absoluteRepoPath = path.posix.join(sourceDir, importPath);
  const normalizedPath = path.posix.normalize(absoluteRepoPath);

  // 2. Try exact match
  if (allFiles.has(normalizedPath)) {
    return normalizedPath;
  }

  // 3. Try with extensions
  const extensions = ['.js', '.ts', '.jsx', '.tsx'];
  for (const ext of extensions) {
    if (allFiles.has(normalizedPath + ext)) {
      return normalizedPath + ext;
    }
  }

  // 4. Try as a directory with index files
  for (const ext of extensions) {
    const indexPath = path.posix.join(normalizedPath, `index${ext}`);
    if (allFiles.has(indexPath)) {
      return indexPath;
    }
  }

  return null;
};

/**
 * Parse a single file and extract import/dependency edges.
 *
 * @param {string} filePath
 * @param {string} source    - Raw file content
 * @param {Set<string>} allFiles - List of all files in the repo for resolution
 * @returns {{ filePath: string, imports: string[], exports: string[] }}
 */
const parseFile = (filePath, source, allFiles = new Set()) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const language = LANGUAGE_MAP[ext];
    if (!language) return { filePath, imports: [], exports: [] };

    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(source);

    const imports = new Set();
    const exports = new Set();

    // Tree-sitter Queries for JS/TS
    const queryStr = `
      ;; ESM Imports
      (import_statement
        source: (string (string_content) @import_path))

      ;; Re-exports
      (export_statement
        source: (string (string_content) @import_path))

      ;; Dynamic imports
      (import_expression
        source: (string (string_content) @import_path))

      ;; CommonJS require
      (call_expression
        function: (identifier) @func_name (#eq? @func_name "require")
        arguments: (arguments (string (string_content) @import_path)))

      ;; Named Exports (e.g., export const x = 1)
      (export_statement
        declaration: [
          (lexical_declaration (variable_declarator name: (identifier) @export_name))
          (function_declaration name: (identifier) @export_name)
          (class_declaration name: (identifier) @export_name)
        ])

      ;; Default Exports
      (export_statement
        (default_specifier) @export_name)
      
      ;; Export list (e.g., export { x, y })
      (export_statement
        (export_clause (export_specifier name: (identifier) @export_name)))
    `;

    const query = new Parser.Query(language, queryStr);
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === 'import_path') {
          const rawPath = capture.node.text;
          const resolved = resolveImportPath(rawPath, filePath, allFiles);
          if (resolved) {
            imports.add(resolved);
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

/**
 * Parse all files in a repository and return a dependency graph.
 *
 * @param {{ path: string, content: string }[]} files
 * @returns {{ nodes: object[], edges: object[] }}
 */
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
