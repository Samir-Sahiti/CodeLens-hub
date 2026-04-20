/**
 * SAST Engine — Pattern-based static analysis (US-046)
 *
 * Mirrors secretScanner.js structure exactly.
 * Runs after AST parsing during indexing.
 */

const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScript = require('tree-sitter-typescript').typescript;
const TSX = require('tree-sitter-typescript').tsx;
const Python = require('tree-sitter-python');
const CSharp = require('tree-sitter-c-sharp');
const path = require('path');
const fs = require('fs').promises;

let _rules = null;

const loadRules = async () => {
  if (_rules) return _rules;
  const rulesDir = path.join(__dirname, '../sast/rules');
  const [js, py, cs, cross] = await Promise.all([
    fs.readFile(path.join(rulesDir, 'javascript.json'),    'utf8').then(JSON.parse),
    fs.readFile(path.join(rulesDir, 'python.json'),        'utf8').then(JSON.parse),
    fs.readFile(path.join(rulesDir, 'c_sharp.json'),       'utf8').then(JSON.parse),
    fs.readFile(path.join(rulesDir, 'cross_language.json'),'utf8').then(JSON.parse),
  ]);
  _rules = { js, py, cs, cross };
  return _rules;
};

const LANG_CONFIG = {
  '.js':  { grammar: JavaScript, ruleKey: 'js' },
  '.jsx': { grammar: TSX,        ruleKey: 'js' },
  '.ts':  { grammar: TypeScript, ruleKey: 'js' },
  '.tsx': { grammar: TSX,        ruleKey: 'js' },
  '.py':  { grammar: Python,     ruleKey: 'py' },
  '.cs':  { grammar: CSharp,     ruleKey: 'cs' },
};

const runAstRules = (tree, grammar, rules, disabledRules) => {
  const findings = [];
  for (const rule of rules) {
    if (disabledRules.includes(rule.id)) continue;
    if (!rule.query) continue;
    try {
      const query = new Parser.Query(grammar, rule.query);
      const matches = query.matches(tree.rootNode);
      for (const match of matches) {
        const node = match.captures[0]?.node;
        if (!node) continue;
        findings.push({ rule, lineNumber: node.startPosition.row + 1 });
      }
    } catch (err) {
      console.warn(`[SAST] Query error for rule ${rule.id}: ${err.message}`);
    }
  }
  return findings;
};

const runRegexRules = (content, filePath, rules, disabledRules) => {
  const findings = [];
  const isTestFile =
    filePath.includes('.test.') || filePath.includes('.spec.') ||
    filePath.includes('__tests__') || filePath.includes('/test/') ||
    filePath.includes('/tests/') || filePath.includes('/spec/');

  const lines = content.split('\n');
  const TIMEOUT_MS = 2000;
  const start = Date.now();

  for (const rule of rules) {
    if (disabledRules.includes(rule.id)) continue;
    if (!rule.pattern) continue;
    if (rule.id === 'cross_http_url' && isTestFile) continue;

    const regex = new RegExp(rule.pattern, 'g');
    for (let i = 0; i < lines.length; i++) {
      if (Date.now() - start > TIMEOUT_MS) {
        console.warn(`[SAST] Regex scan timeout for ${filePath}`);
        return findings;
      }
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        findings.push({ rule, lineNumber: i + 1 });
      }
    }
  }
  return findings;
};

const scanFileForInsecurePatterns = async (filePath, content, disabledRules = []) => {
  const issues = [];
  const rules = await loadRules();
  const ext = path.extname(filePath).toLowerCase();
  const langConfig = LANG_CONFIG[ext];

  // AST-based rules
  if (langConfig) {
    try {
      const parser = new Parser();
      parser.setLanguage(langConfig.grammar);
      const tree = parser.parse(content);
      const langRules = rules[langConfig.ruleKey] || [];
      const findings = runAstRules(tree, langConfig.grammar, langRules, disabledRules);
      for (const { rule, lineNumber } of findings) {
        issues.push({
          type: 'insecure_pattern',
          severity: rule.severity,
          file_paths: [filePath],
          description: `[Line ${lineNumber}] ${rule.name}: ${rule.description}${rule.cwe ? ` (${rule.cwe})` : ''} — Fix: ${rule.fixHint}`,
          _meta: { rule_id: rule.id, line_number: lineNumber },
        });
      }
    } catch (err) {
      console.warn(`[SAST] AST scan failed for ${filePath}: ${err.message}`);
    }
  }

  // Regex-based rules (AST languages + cross-language pattern rules)
  const allRegexRules = [
    ...((rules[langConfig?.ruleKey] || []).filter(r => r.pattern && !r.query)),
    ...rules.cross,
  ];
  if (langConfig || ['.go', '.java', '.rs', '.rb'].includes(ext)) {
    try {
      const findings = runRegexRules(content, filePath, allRegexRules, disabledRules);
      for (const { rule, lineNumber } of findings) {
        issues.push({
          type: 'insecure_pattern',
          severity: rule.severity,
          file_paths: [filePath],
          description: `[Line ${lineNumber}] ${rule.name}: ${rule.description}${rule.cwe ? ` (${rule.cwe})` : ''} — Fix: ${rule.fixHint}`,
          _meta: { rule_id: rule.id, line_number: lineNumber },
        });
      }
    } catch (err) {
      console.warn(`[SAST] Regex scan failed for ${filePath}: ${err.message}`);
    }
  }

  return issues;
};

module.exports = { scanFileForInsecurePatterns };
