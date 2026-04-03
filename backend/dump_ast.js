const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const TSX = require('tree-sitter-typescript').tsx;

const code = 'export class MyClass {}';

function dump(lang, name) {
  console.log(`--- ${name} ---`);
  const p = new Parser();
  p.setLanguage(lang);
  const tree = p.parse(code);
  console.log(tree.rootNode.toString());
}

dump(JavaScript, 'JS');
dump(TypeScript, 'TS');
dump(TSX, 'TSX');
