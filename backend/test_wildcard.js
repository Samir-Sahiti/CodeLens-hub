const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const TSX = require('tree-sitter-typescript').tsx;

const segments = [
  '(class_declaration name: (_) @export_name)',
  '(export_statement declaration: (class_declaration name: (_) @export_name))',
  '(export_statement (class_declaration name: (_) @export_name))'
];

function test(lang, name) {
  console.log(`--- Testing ${name} ---`);
  segments.forEach(s => {
    try {
      const p = new Parser();
      p.setLanguage(lang);
      new Parser.Query(lang, s);
      console.log(`  OK: ${s}`);
    } catch (err) {
      console.error(`  FAIL: ${s} -> ${err.message}`);
    }
  });
}

test(JavaScript, 'JS');
test(TypeScript, 'TS');
test(TSX, 'TSX');
