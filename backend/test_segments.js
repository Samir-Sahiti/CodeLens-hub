const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const TSX = require('tree-sitter-typescript').tsx;

const segments = [
  '(import_statement (string) @import_path)',
  '(export_statement (string) @import_path)',
  '(call_expression (import) (arguments (string) @import_path))',
  '(call_expression (identifier) @require (#eq? @require "require") (arguments (string) @import_path))',
  '(export_statement (function_declaration (identifier) @export_name))',
  '(export_statement (lexical_declaration (variable_declarator (identifier) @export_name)))',
  '(export_statement (class_declaration (identifier) @export_name))',
  '(class_declaration (identifier) @export_name)',
  '(class_declaration ["export"] (identifier) @export_name)',
  '(export_statement [(identifier) (function_declaration) (class_declaration)] @export_name)',
  '(export_specifier (identifier) @export_name)'
];

function test(lang, name) {
  console.log(`--- Testing ${name} ---`);
  segments.forEach(s => {
    try {
      const p = new Parser();
      p.setLanguage(lang);
      new Parser.Query(lang, s);
      // console.log(`  OK: ${s}`);
    } catch (err) {
      console.error(`  FAIL: ${s} -> ${err.message}`);
    }
  });
}

test(JavaScript, 'JS');
test(TypeScript, 'TS');
test(TSX, 'TSX');
