const Parser = require('tree-sitter');
const Rust = require('tree-sitter-rust');
const path = require('path');

const queryStr = `
  (mod_item name: (identifier) @mod_name)
  (use_declaration argument: (scoped_identifier) @use_path)
  (use_declaration argument: (identifier) @use_path)
`;

const resolveRustImport = (type, value, filePath, allFiles) => {
  if (type === 'mod') {
    // mod foo -> look for foo.rs or foo/mod.rs relative to current file
    const currentDir = path.posix.dirname(filePath);
    const candidates = [
        path.posix.join(currentDir, `${value}.rs`),
        path.posix.join(currentDir, value, 'mod.rs')
    ];
    for (const cand of candidates) {
        const norm = path.posix.normalize(cand);
        if (allFiles.has(norm)) return norm;
    }
  } else if (type === 'use') {
    // use crate::foo::bar -> resolve within repo
    const parts = value.split('::').filter(p => p !== 'crate' && p !== 'super' && p !== 'self');
    if (parts.length > 0) {
        // try to find parts matching file paths
        const lastPart = parts[parts.length - 1];
        const target = `${lastPart}.rs`;
        for (const f of allFiles) {
            if (f === target || f.endsWith(`/${target}`)) {
                return f;
            }
        }
    }
  }
  return null;
};

const parseRust = (filePath, content, allFiles) => {
  try {
    const parser = new Parser();
    parser.setLanguage(Rust);
    const tree = parser.parse(content);

    const imports = new Set();
    const exports = new Set();

    const query = new Parser.Query(Rust, queryStr);
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === 'mod_name') {
            const resolved = resolveRustImport('mod', capture.node.text, filePath, allFiles);
            if (resolved) imports.add(resolved);
        } else if (capture.name === 'use_path') {
            const text = capture.node.text;
            const resolved = resolveRustImport('use', text, filePath, allFiles);
            if (resolved) imports.add(resolved);
        }
      }
    }

    return {
      filePath,
      imports: Array.from(imports),
      exports: Array.from(exports)
    };
  } catch (err) {
    console.warn(`[Parser] Failed to parse Rust ${filePath}: ${err.message}`);
    return { filePath, imports: [], exports: [] };
  }
};

module.exports = { parseRust };
