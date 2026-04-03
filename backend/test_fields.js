const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const TSX = require('tree-sitter-typescript').tsx;

const segments = [
  '(export_statement (lexical_declaration (variable_declarator [(identifier) (type_identifier)] @export_name)))',
  '(export_statement (function_declaration [(identifier) (type_identifier)] @export_name))',
  '(export_statement (class_declaration [(identifier) (type_identifier)] @export_name))',
  '(export_statement [(identifier) (type_identifier)] @export_name)',
  '(export_specifier [(identifier) (type_identifier)] @export_name)'
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
