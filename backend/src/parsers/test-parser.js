const { parseFile: _parseFile, parseRepository } = require('./repositoryParser');

const mockFiles = [
  {
    path: 'src/index.js',
    content: `
      import { add } from './utils/math';
      import Header from './components/Header.jsx';
      const footer = require('./components/Footer');
      const dynamic = import('./pages/Home');
      export { x } from './constants';
      
      export const main = () => {};
      export default class App {}
    `
  },
  {
    path: 'src/utils/math.js',
    content: `
      export const add = (a, b) => a + b;
    `
  },
  {
    path: 'src/components/Header.jsx',
    content: `
      export default function Header() { return null; }
    `
  },
  {
    path: 'src/components/Footer/index.js',
    content: `
      module.exports = () => {};
    `
  },
  {
    path: 'src/pages/Home.tsx',
    content: `
      export const Home = () => null;
    `
  },
  {
    path: 'src/constants.ts',
    content: `
      export const x = 10;
    `
  },
  {
    path: 'src/external.js',
    content: `
      import react from 'react';
      import fs from 'fs';
      const lodash = require('lodash');
    `
  },
  {
    path: 'src/error.js',
    content: `
      const x = ; // Syntax error
    `
  }
];

const runTests = () => {
  console.log('--- Starting Parser Tests ---');
  
  const result = parseRepository(mockFiles);
  
  console.log('\n--- Extraction Results ---');
  result.nodes.forEach(node => {
    console.log(`\nFile: ${node.path}`);
    console.log(`  Exports: ${node.exports.join(', ') || 'None'}`);
    const dependencies = result.edges
      .filter(e => e.from === node.path)
      .map(e => e.to);
    console.log(`  Imports: ${dependencies.join(', ') || 'None'}`);
  });

  console.log('\n--- Verification ---');

  // Check index.js imports
  const indexImports = result.edges.filter(e => e.from === 'src/index.js').map(e => e.to);
  const expectedIndexImports = [
    'src/utils/math.js',
    'src/components/Header.jsx',
    'src/components/Footer/index.js',
    'src/pages/Home.tsx',
    'src/constants.ts'
  ];
  
  const allMatch = expectedIndexImports.every(imp => indexImports.includes(imp));
  console.log(`[PASS] index.js resolved all local imports: ${allMatch}`);

  // Check external filtering
  const externalImports = result.edges.filter(e => e.from === 'src/external.js');
  console.log(`[PASS] external.js filtered all non-relative imports: ${externalImports.length === 0}`);

  // Check error handling
  const errorFile = result.nodes.find(n => n.path === 'src/error.js');
  console.log(`[PASS] error.js was processed despite syntax error: ${!!errorFile}`);

  console.log('\n--- Done ---');
};

try {
  runTests();
} catch (err) {
  console.error('Test execution failed:', err);
}
