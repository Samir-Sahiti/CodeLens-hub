const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;

const queries = {
  javascript: `
    ;; ESM Imports
    (import_statement
      source: (string (string_fragment) @import_path))

    ;; Re-exports
    (export_statement
      source: (string (string_fragment) @import_path))

    ;; Dynamic imports
    (call_expression
      function: (import)
      arguments: (arguments (string (string_fragment) @import_path)))

    ;; CommonJS require
    (call_expression
      function: (identifier) @func_name (#eq? @func_name "require")
      arguments: (arguments (string (string_fragment) @import_path)))

    ;; Named Exports (e.g., export const x = 1)
    (export_statement
      declaration: [
        (lexical_declaration (variable_declarator name: (identifier) @export_name))
        (function_declaration name: (identifier) @export_name)
        (class_declaration name: (identifier) @export_name)
      ])

    ;; Default Exports (simplified)
    (export_statement
      value: (identifier) @export_name)
    
    ;; Export list (e.g., export { x, y })
    (export_statement
      (export_clause (export_specifier (identifier) @export_name)))
  `
};

function testQuery(lang, queryStr) {
  try {
    const parser = new Parser();
    parser.setLanguage(lang);
    new Parser.Query(lang, queryStr);
    console.log("Query is valid");
  } catch (err) {
    console.error("Query Error:", err.message);
    // Try to find the position
    const match = err.message.match(/at position (\d+)/);
    if (match) {
      const pos = parseInt(match[1]);
      console.log("Problematic part:", queryStr.substring(Math.max(0, pos - 20), pos + 20));
      console.log("Character at pos:", queryStr[pos]);
    }
  }
}

console.log("Testing JavaScript...");
testQuery(JavaScript, queries.javascript);

console.log("\nTesting TypeScript...");
testQuery(TypeScript, queries.javascript);
