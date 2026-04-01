const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');

const parser = new Parser();
parser.setLanguage(JavaScript);

const code = `
import { x } from './y';
export const a = 1;
export default class B {}
export { z } from './w';
`;

const tree = parser.parse(code);

const printNode = (node, indent = '') => {
  console.log(`${indent}${node.type} [${node.startPosition.row}, ${node.startPosition.column}] - [${node.endPosition.row}, ${node.endPosition.column}]`);
  for (let i = 0; i < node.childCount; i++) {
    printNode(node.child(i), indent + '  ');
  }
};

printNode(tree.rootNode);
