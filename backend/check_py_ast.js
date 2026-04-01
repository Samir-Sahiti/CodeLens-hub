const Parser = require('tree-sitter');
const Python = require('tree-sitter-python');

const parser = new Parser();
parser.setLanguage(Python);
const source = "class x: pass";
const tree = parser.parse(source);
console.log(tree.rootNode.toString());
