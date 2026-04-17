const Parser = require('tree-sitter');
const Go = require('tree-sitter-go');

const queryStr = `
  (import_spec path: (interpreted_string_literal) @import_path)
  (import_spec path: (raw_string_literal) @import_path)
`;

const resolveGoImport = (importPath, allFiles) => {
  const parts = importPath.split('/');
  const lastPart = parts[parts.length - 1];

  if (allFiles.has(`${lastPart}.go`)) return `${lastPart}.go`;
  if (allFiles.has(`${importPath}.go`)) return `${importPath}.go`;

  const matches = [];
  for (const file of allFiles) {
    if (file.startsWith(`${lastPart}/`) || file.includes(`/${lastPart}/`)) {
      matches.push(file);
    }
  }
  if (matches.length > 0) return matches;

  return null;
};

const parseGo = (filePath, content, allFiles) => {
  try {
    const parser = new Parser();
    parser.setLanguage(Go);
    const tree = parser.parse(content);

    const imports = new Set();

    const query = new Parser.Query(Go, queryStr);
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === 'import_path') {
          let rawPath = capture.node.text;
          if ((rawPath.startsWith('"') && rawPath.endsWith('"')) ||
              (rawPath.startsWith('`') && rawPath.endsWith('`'))) {
            rawPath = rawPath.slice(1, -1);
          }
          const resolved = resolveGoImport(rawPath, allFiles);
          if (resolved) {
            if (Array.isArray(resolved)) {
              resolved.forEach(r => imports.add(r));
            } else {
              imports.add(resolved);
            }
          }
        }
      }
    }

    return {
      filePath,
      imports: Array.from(imports),
      exports: []
    };
  } catch (err) {
    console.warn(`[Parser] Failed to parse Go ${filePath}: ${err.message}`);
    return { filePath, imports: [], exports: [] };
  }
};

module.exports = { parseGo };
