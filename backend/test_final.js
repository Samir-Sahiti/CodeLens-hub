const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const TSX = require('tree-sitter-typescript').tsx;

const queryStr = `
  ;; ESM Imports: import { x } from "./foo"
  (import_statement (string) @import_path)

  ;; Re-exports: export { x } from "./foo"
  (export_statement (string) @import_path)

  ;; Dynamic imports: import("./foo")
  (call_expression
    (import)
    (arguments (string) @import_path))

  ;; CommonJS require: require("./foo")
  (call_expression
    (identifier) @require_ident (#eq? @require_ident "require")
    (arguments (string) @import_path))

  ;; Named Exports
  (export_statement
    (lexical_declaration (variable_declarator name: (_) @export_name)))
  (export_statement
    (function_declaration name: (_) @export_name))
  (export_statement
    (class_declaration name: (_) @export_name))

  ;; Default Exports
  (export_statement
    value: (_) @export_name)
  (export_statement
    (function_declaration name: (_) @export_name))
  (export_statement
    (class_declaration name: (_) @export_name))
  
  ;; Export list
  (export_specifier name: (_) @export_name)
  (export_specifier alias: (_) @export_name)
`;

function test(lang, name) {
  try {
    const p = new Parser();
    p.setLanguage(lang);
    new Parser.Query(lang, queryStr);
    console.log(`${name}: OK`);
  } catch (err) {
    console.error(`${name} Error:`, err.message);
  }
}

test(JavaScript, 'JS');
test(TypeScript, 'TS');
test(TSX, 'TSX');
