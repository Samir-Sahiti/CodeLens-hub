const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const Python = require('tree-sitter-python');
const CSharp = require('tree-sitter-c-sharp');

const LANGUAGE_MAP = {
  '.js': JavaScript,
  '.jsx': JavaScript,
  '.ts': TypeScript,
  '.tsx': TypeScript,
  '.py': Python,
  '.cs': CSharp,
};

/**
 * Parse a single file and extract import/dependency edges.
 *
 * @param {string} filePath
 * @param {string} source    - Raw file content
 * @returns {{ imports: string[], exports: string[] }}
 */
const parseFile = (filePath, source) => {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  const language = LANGUAGE_MAP[ext];
  if (!language) return { imports: [], exports: [] };

  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);

  // TODO: walk tree.rootNode and extract import declarations
  return { imports: [], exports: [] };
};

/**
 * Parse all files in a repository and return a dependency graph.
 *
 * @param {{ path: string, content: string }[]} files
 * @returns {{ nodes: object[], edges: object[] }}
 */
const parseRepository = (files) => {
  const nodes = [];
  const edges = [];

  for (const file of files) {
    const { imports } = parseFile(file.path, file.content);
    nodes.push({ path: file.path });
    for (const imp of imports) {
      edges.push({ from: file.path, to: imp });
    }
  }

  return { nodes, edges };
};

module.exports = { parseFile, parseRepository };
