/**
 * Cyclomatic complexity calculator using Tree-sitter AST.
 */

const COMPLEXITY_VARS = {
  javascript: {
    funcs: ['function_declaration', 'function', 'arrow_function', 'method_definition'],
    decisions: ['if_statement', 'else_clause', 'for_statement', 'while_statement', 'do_statement', 'switch_case', 'ternary_expression', 'catch_clause']
  },
  c_sharp: {
    funcs: ['method_declaration', 'local_function_statement', 'constructor_declaration'],
    decisions: ['if_statement', 'else_clause', 'for_statement', 'while_statement', 'do_statement', 'switch_section', 'conditional_expression', 'catch_clause', 'conditional_access_expression']
  },
  python: {
    funcs: ['function_definition'],
    decisions: ['if_statement', 'elif_clause', 'for_statement', 'while_statement', 'except_clause', 'conditional_expression']
  },
  go: {
    funcs: ['function_declaration', 'method_declaration', 'func_literal'],
    decisions: ['if_statement', 'for_statement', 'expression_case', 'type_case', 'communication_case']
  },
  java: {
    funcs: ['method_declaration', 'constructor_declaration'],
    decisions: ['if_statement', 'else_clause', 'for_statement', 'while_statement', 'do_statement', 'switch_label', 'ternary_expression', 'catch_clause']
  },
  rust: {
    funcs: ['function_item', 'closure_expression'],
    decisions: ['if_expression', 'else_clause', 'for_expression', 'while_expression', 'loop_expression', 'match_arm']
  },
  ruby: {
    funcs: ['method', 'singleton_method', 'block'],
    decisions: ['if', 'elsif', 'unless', 'case_match', 'when', 'rescue', 'for', 'while', 'until']
  }
};

function calculateComplexity(tree, language) {
  if (!tree || !tree.rootNode) return 1;
  
  let langKey = language;
  if (['typescript', 'tsx', 'jsx', 'js'].includes(langKey)) langKey = 'javascript';
  if (langKey === 'csharp' || langKey === 'cs') langKey = 'c_sharp';
  
  const conf = COMPLEXITY_VARS[langKey] || { funcs: [], decisions: [] };
  const fnNodes = new Set(conf.funcs);
  const decNodes = new Set(conf.decisions);
  
  let functionCount = 0;
  let decisionCount = 0;
  
  function walk(node) {
    if (fnNodes.has(node.type)) functionCount++;
    if (decNodes.has(node.type)) decisionCount++;
    else if (node.type === 'binary_expression') {
      const op = node.child(1)?.text;
      if (op === '&&' || op === '||') decisionCount++;
    } else if (node.type === 'boolean_operator') {
      const op = node.child(1)?.text;
      if (['and', 'or', '&&', '||'].includes(op)) decisionCount++;
    }
    
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }
  
  try {
    walk(tree.rootNode);
  } catch (err) {
    console.warn('[complexity] Error walking tree', err);
  }
  
  return decisionCount + Math.max(1, functionCount);
}

module.exports = { calculateComplexity };
