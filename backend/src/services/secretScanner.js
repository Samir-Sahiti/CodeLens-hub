const fs = require('fs').promises;
const path = require('path');

function calculateEntropy(str) {
  const len = str.length;
  const frequencies = Array.from(str).reduce((freq, c) => {
    freq[c] = (freq[c] || 0) + 1;
    return freq;
  }, {});

  return Object.values(frequencies).reduce((sum, f) => {
    const p = f / len;
    return sum - (p * Math.log2(p));
  }, 0);
}

let compiledRules = null;
const loadRules = async () => {
  if (!compiledRules) {
    const rulesPath = path.join(__dirname, '../sast/secret-rules.json');
    const data = await fs.readFile(rulesPath, 'utf8');
    compiledRules = JSON.parse(data).map(r => ({
      ...r,
      regex: new RegExp(r.pattern, 'g') // pre-compile for speed
    }));
  }
  return compiledRules;
};

// Generic high-entropy assignment detection
const highEntropyRegex = /(?:key|secret|token|password)[\s]*[:=][\s]*['"]([a-zA-Z0-9\-_+/=]{20,})['"]/gi;

const scanFileForSecrets = async (filePath, content) => {
  const issues = [];
  const rules = await loadRules();
  const lines = content.split('\n');

  const startTime = Date.now();
  const TIMEOUT_MS = 2000;

  for (let i = 0; i < lines.length; i++) {
    // Prevent ReDoS timeouts on malicious/huge files
    if (Date.now() - startTime > TIMEOUT_MS) {
      console.warn(`[SecretScanner] Timeout exceeded for ${filePath}`);
      break;
    }

    const line = lines[i];
    if (!line.trim()) continue;

    // 1. Explicit regex rules
    for (const rule of rules) {
      if (rule.regex.test(line)) {
        issues.push({
          repo_id: null, // Will be filled by indexer
          type: 'hardcoded_secret',
          severity: rule.severity,
          file_paths: [filePath],
          description: `Hardcoded ${rule.name} detected at line ${i + 1} (Rule ID: ${rule.id})`,
          // We attach these temporarily; the indexer will need them to check against suppressions
          _meta: { rule_id: rule.id, line_number: i + 1 }
        });
      }
      rule.regex.lastIndex = 0; // reset regex state
    }

    // 2. High entropy catch-all
    let match;
    while ((match = highEntropyRegex.exec(line)) !== null) {
      if (calculateEntropy(match[1]) > 4.5) {
        issues.push({
          repo_id: null, // Will be filled by indexer
          type: 'hardcoded_secret',
          severity: 'high',
          file_paths: [filePath],
          description: `High-entropy string assigned to sensitive variable detected at line ${i + 1} (Rule ID: generic_high_entropy)`,
          _meta: { rule_id: 'generic_high_entropy', line_number: i + 1 }
        });
      }
    }
  }

  return issues;
};

module.exports = { scanFileForSecrets };
