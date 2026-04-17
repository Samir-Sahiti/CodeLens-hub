const Parser = require('tree-sitter');
const Ruby = require('tree-sitter-ruby');
const path = require('path');

const queryStr = `
  (call method: (identifier) @req (#eq? @req "require") arguments: (argument_list (string (string_content) @req_path)))
  (call method: (identifier) @req_rel (#eq? @req_rel "require_relative") arguments: (argument_list (string (string_content) @req_rel_path)))
`;

// AC: require_relative './helper' -> resolve relative to current file; require calls matched against repo files
const resolveRubyImport = (type, importPath, sourceFile, allFiles) => {
  if (type === 'require_relative') {
      const sourceDir = path.posix.dirname(sourceFile);
      // Remove leading ./ if present, but path.posix.join handles dots
      const absoluteReq = path.posix.join(sourceDir, importPath);
      const normalizedPath = path.posix.normalize(absoluteReq);
      
      const target = normalizedPath.endsWith('.rb') ? normalizedPath : `${normalizedPath}.rb`;
      if (allFiles.has(target)) return target;
  } else if (type === 'require') {
      const target = importPath.endsWith('.rb') ? importPath : `${importPath}.rb`;
      const lastPart = target.split('/').pop();

      // Check exact match ending with the full target
      for (const f of allFiles) {
          if (f === target || f.endsWith(`/${target}`)) {
              return f;
          }
      }
      // Check just filename match as fallback
      for (const f of allFiles) {
          if (f.endsWith(`/${lastPart}`) || f === lastPart) return f;
      }
  }
  return null;
};

const parseRuby = (filePath, content, allFiles) => {
  try {
    const parser = new Parser();
    parser.setLanguage(Ruby);
    const tree = parser.parse(content);

    const imports = new Set();
    const exports = new Set();

    const query = new Parser.Query(Ruby, queryStr);
    const matches = query.matches(tree.rootNode);

    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === 'req_rel_path' || capture.name === 'req_path') {
            const rawPath = capture.node.text;
            const type = capture.name === 'req_rel_path' ? 'require_relative' : 'require';
            const resolved = resolveRubyImport(type, rawPath, filePath, allFiles);
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
    console.warn(`[Parser] Failed to parse Ruby ${filePath}: ${err.message}`);
    return { filePath, imports: [], exports: [] };
  }
};

module.exports = { parseRuby };
