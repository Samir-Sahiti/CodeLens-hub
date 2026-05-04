const fs = require('fs/promises');
const path = require('path');

const TEST_FILE_REGEXES = [
  /(^|\/)(__tests__|tests|spec|test)\/.+/i,
  /(^|\/)[^/]+\.(test|spec)\.[^/]+$/i,
  /(^|\/)test_[^/]+\.py$/i,
  /(^|\/)[^/]+_test\.go$/i,
  /(^|\/)[^/]+Test\.java$/,
  /(^|\/)[^/]+Tests\.cs$/,
];

function normalizeRepoPath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function stripCoveragePrefix(filePath) {
  let normalized = normalizeRepoPath(filePath);
  normalized = normalized.replace(/^(home\/runner\/work\/[^/]+\/[^/]+\/)/i, '');
  normalized = normalized.replace(/^(github\/workspace\/|workspace\/|build\/)/i, '');
  normalized = normalized.replace(/\/(github\/workspace|workspace|build)\//i, '/');
  return normalized.replace(/^\/+/, '');
}

function isTestFilePath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return TEST_FILE_REGEXES.some((regex) => regex.test(normalized));
}

async function findCoverageFiles(rootDir) {
  const coverageFiles = [];

  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      console.warn(`[coverage] Failed to scan ${dir}: ${error.message}`);
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (['.git', 'node_modules', 'vendor', '__pycache__', '.cache'].includes(entry.name)) continue;
        await walk(path.join(dir, entry.name));
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = normalizeRepoPath(path.relative(rootDir, fullPath));
      const lower = relativePath.toLowerCase();
      if (lower.endsWith('/coverage.xml') || lower === 'coverage.xml' || lower.endsWith('/coverage.json') || lower === 'coverage.json' || lower.endsWith('.lcov')) {
        coverageFiles.push({ path: relativePath, fsPath: fullPath });
      }
    }
  }

  await walk(rootDir);
  coverageFiles.sort((a, b) => a.path.localeCompare(b.path));
  return coverageFiles;
}

function parseLcov(content) {
  const rows = [];
  let current = null;

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      current = { filePath: stripCoveragePrefix(line.slice(3).trim()), found: 0, hit: 0 };
    } else if (current && line.startsWith('LF:')) {
      current.found = Number(line.slice(3)) || 0;
    } else if (current && line.startsWith('LH:')) {
      current.hit = Number(line.slice(3)) || 0;
    } else if (line === 'end_of_record' && current) {
      rows.push({ filePath: current.filePath, percentage: current.found > 0 ? (current.hit / current.found) * 100 : 0 });
      current = null;
    }
  }

  return rows;
}

function parseIstanbulJson(content) {
  const parsed = JSON.parse(content);
  return Object.entries(parsed)
    .filter(([, value]) => value && typeof value === 'object' && value.statementMap && value.s)
    .map(([filePath, value]) => {
      const counts = Object.values(value.s).map(Number);
      const hit = counts.filter((count) => count > 0).length;
      return { filePath: stripCoveragePrefix(filePath), percentage: counts.length > 0 ? (hit / counts.length) * 100 : 0 };
    });
}

function parseCoberturaXml(content) {
  if (!/<coverage[\s>]/i.test(content) || !/<class[\s>]/i.test(content)) {
    throw new Error('coverage.xml is not Cobertura-like');
  }

  const rows = [];
  const classRegex = /<class\b[^>]*>/gi;
  let match;
  while ((match = classRegex.exec(content)) !== null) {
    const tag = match[0];
    const filename = tag.match(/\bfilename=["']([^"']+)["']/i)?.[1];
    if (!filename) continue;
    const rawRate = tag.match(/\bline-rate=["']([^"']+)["']/i)?.[1];
    const lineRate = rawRate == null ? null : Number(rawRate);
    if (Number.isFinite(lineRate)) {
      rows.push({ filePath: stripCoveragePrefix(filename), percentage: Math.max(0, Math.min(100, lineRate * 100)) });
    }
  }

  if (rows.length === 0) throw new Error('coverage.xml contained no Cobertura class line-rate entries');
  return rows;
}

function levenshteinCapped(a, b, cap = 64) {
  const left = a.slice(-cap);
  const right = b.slice(-cap);
  const prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const temp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (left[i - 1] === right[j - 1] ? 0 : 1));
      last = temp;
    }
  }
  return prev[right.length];
}

function buildCoveragePathMatcher(repoRoot, repoPaths) {
  const exact = new Map(repoPaths.map((p) => [normalizeRepoPath(p), p]));
  const absolute = new Map(repoPaths.map((p) => [normalizeRepoPath(path.resolve(repoRoot, p)), p]));
  const byBasename = new Map();
  for (const repoPath of repoPaths) {
    const basename = normalizeRepoPath(repoPath).split('/').pop();
    if (!byBasename.has(basename)) byBasename.set(basename, []);
    byBasename.get(basename).push(repoPath);
  }

  return (coveragePath) => {
    const normalized = stripCoveragePrefix(coveragePath);
    if (exact.has(normalized)) return exact.get(normalized);
    if (absolute.has(normalized)) return absolute.get(normalized);

    const basename = normalized.split('/').pop();
    const candidates = byBasename.get(basename) || [];
    const suffixMatches = candidates.filter((repoPath) => normalized.endsWith(normalizeRepoPath(repoPath)) || normalizeRepoPath(repoPath).endsWith(normalized));
    if (suffixMatches.length === 1) return suffixMatches[0];
    if (suffixMatches.length > 1) {
      return suffixMatches
        .map((repoPath) => ({ repoPath, distance: levenshteinCapped(normalized, normalizeRepoPath(path.resolve(repoRoot, repoPath))) }))
        .sort((a, b) => a.distance - b.distance || a.repoPath.localeCompare(b.repoPath))[0].repoPath;
    }
    return null;
  };
}

async function parseCoverageOverrides(rootDir, repoPaths) {
  const files = await findCoverageFiles(rootDir);
  if (files.length === 0) return { coverageByPath: new Map(), hasCoverageFiles: false };

  const matchPath = buildCoveragePathMatcher(rootDir, repoPaths);
  const coverageByPath = new Map();

  for (const file of files) {
    try {
      const content = await fs.readFile(file.fsPath, 'utf-8');
      const lower = file.path.toLowerCase();
      let rows = [];
      if (lower.endsWith('.lcov')) rows = parseLcov(content);
      else if (lower.endsWith('coverage.json')) rows = parseIstanbulJson(content);
      else if (lower.endsWith('coverage.xml')) rows = parseCoberturaXml(content);

      for (const row of rows) {
        const repoPath = matchPath(row.filePath);
        if (!repoPath) continue;
        coverageByPath.set(repoPath, Math.max(0, Math.min(100, row.percentage)));
      }
    } catch (error) {
      console.warn(`[coverage] Failed to parse ${file.path}: ${error.message}. Falling back to import heuristic for unmatched files.`);
    }
  }

  return { coverageByPath, hasCoverageFiles: files.length > 0 };
}

module.exports = {
  isTestFilePath,
  normalizeRepoPath,
  parseCoverageOverrides,
};
