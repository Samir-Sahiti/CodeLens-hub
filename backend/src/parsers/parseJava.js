const Parser = require('tree-sitter');
const Java = require('tree-sitter-java');

const queryStr = `
  (package_declaration (scoped_identifier) @export_name)
  (package_declaration (identifier) @export_name)
  (import_declaration (scoped_identifier) @import_path)
  (import_declaration (identifier) @import_path)
`;

const resolveJavaImport = (importPath, allFiles) => {
  const parts = importPath.split('.');
  const className = parts[parts.length - 1];
  const target = `${className}.java`;
  
  for (const f of allFiles) {
    if (f === target || f.endsWith(`/${target}`)) {
      return f;
    }
  }

  const asPath = importPath.replace(/\./g, '/') + '.java';
  for (const f of allFiles) {
     if (f.endsWith(asPath)) return f;
  }

  // Check if wildcard import like .*
  if (className === '*') {
      const packagePath = parts.slice(0, -1).join('/');
      const matches = [];
      for (const f of allFiles) {
          if (f.includes(packagePath)) matches.push(f);
      }
      if (matches.length > 0) return matches;
  }

  return null;
};

const parseJava = (filePath, content, allFiles) => {
  try {
    const parser = new Parser();
    parser.setLanguage(Java);
    const tree = parser.parse(content);

    const imports = new Set();
    const exports = new Set();

    const query = new Parser.Query(Java, queryStr);
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === 'import_path') {
          const resolved = resolveJavaImport(capture.node.text, allFiles);
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
    console.warn(`[Parser] Failed to parse Java ${filePath}: ${err.message}`);
    return { filePath, imports: [], exports: [] };
  }
};

module.exports = { parseJava };
