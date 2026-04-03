const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const TSX = require('tree-sitter-typescript').tsx;

const queryStr = \`
(import_statement (string) @import_path)
(export_statement (string) @import_path)
(call_expression (import) (arguments (string) @import_path))
(call_expression (identifier) @require_ident (#eq? @require_ident "require") (arguments (string) @import_path))
(export_statement (function_declaration (identifier) @export_name))
(export_statement (class_declaration (identifier) @export_name))
(export_statement (lexical_declaration (variable_declarator (identifier) @export_name)))
(export_statement (identifier) @export_name)
(export_specifier (identifier) @export_name)
\`;

function test(lang, name) {
  try {
    const p = new Parser();
    p.setLanguage(lang);
    new Parser.Query(lang, queryStr);
    console.log(\`\${name}: OK\`);
  } catch (err) {
    console.error(\`\${name} Error:\`, err.message);
  }
}

test(JavaScript, 'JS');
test(TypeScript, 'TS');
test(TSX, 'TSX');
