/**
 * Manifest Parser — US-045 Dependency Vulnerability Scanning (SCA)
 *
 * Pure-logic module (no I/O, no DB calls).
 * Detects and parses dependency manifests from file content, returning a list
 * of { ecosystem, name, version, manifest_path, is_transitive } tuples.
 *
 * Supported manifests:
 *   package.json, package-lock.json, yarn.lock  → npm
 *   requirements.txt, Pipfile.lock              → PyPI
 *   go.mod                                      → Go
 *   Cargo.lock                                  → crates.io
 *   Gemfile.lock                                → RubyGems
 *   *.csproj                                    → NuGet
 */

const path = require('path');

const MANIFEST_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'requirements.txt',
  'pipfile.lock',
  'go.mod',
  'cargo.lock',
  'gemfile.lock',
]);

/**
 * Returns true if filePath is a recognised dependency manifest.
 * @param {string} filePath - Relative file path from the repo root
 * @returns {boolean}
 */
function isManifestFile(filePath) {
  const basename = path.basename(filePath).toLowerCase();
  if (MANIFEST_BASENAMES.has(basename)) return true;
  // *.csproj
  if (filePath.toLowerCase().endsWith('.csproj')) return true;
  return false;
}

/**
 * Parse a manifest file and return all detected dependencies.
 * @param {string} filePath - Relative file path (used to identify manifest type)
 * @param {string} content  - Raw file content string
 * @returns {Array<{ecosystem: string, name: string, version: string, manifest_path: string, is_transitive: boolean}>}
 */
function parseManifest(filePath, content) {
  const basename = path.basename(filePath).toLowerCase();

  try {
    if (basename === 'package.json')      return parsePackageJson(content, filePath);
    if (basename === 'package-lock.json') return parsePackageLockJson(content, filePath);
    if (basename === 'yarn.lock')         return parseYarnLock(content, filePath);
    if (basename === 'requirements.txt')  return parseRequirementsTxt(content, filePath);
    if (basename === 'pipfile.lock')      return parsePipfileLock(content, filePath);
    if (basename === 'go.mod')            return parseGoMod(content, filePath);
    if (basename === 'cargo.lock')        return parseCargoLock(content, filePath);
    if (basename === 'gemfile.lock')      return parseGemfileLock(content, filePath);
    if (filePath.toLowerCase().endsWith('.csproj')) return parseCsproj(content, filePath);
  } catch (err) {
    console.warn(`[manifestParser] Failed to parse ${filePath}: ${err.message}`);
  }
  return [];
}

// ── Individual parsers ────────────────────────────────────────────────────────

function parsePackageJson(content, manifestPath) {
  const pkg = JSON.parse(content);
  // Skip if this is a package-lock.json accidentally named or a workspace root with no versions
  if (typeof pkg !== 'object' || pkg === null) return [];

  const deps = [];
  for (const [name, rawVer] of Object.entries(pkg.dependencies || {})) {
    const version = cleanVersion(rawVer);
    if (version) deps.push({ ecosystem: 'npm', name, version, manifest_path: manifestPath, is_transitive: false });
  }
  for (const [name, rawVer] of Object.entries(pkg.devDependencies || {})) {
    const version = cleanVersion(rawVer);
    if (version) deps.push({ ecosystem: 'npm', name, version, manifest_path: manifestPath, is_transitive: false });
  }
  return deps;
}

function parsePackageLockJson(content, manifestPath) {
  const lock = JSON.parse(content);
  const deps = [];

  // v2/v3 format: packages field
  if (lock.packages) {
    for (const [pkgPath, info] of Object.entries(lock.packages)) {
      if (pkgPath === '') continue; // skip root package entry
      // Extract real package name from path like node_modules/foo or node_modules/foo/node_modules/bar
      const name = pkgPath.replace(/^.*node_modules\//, '');
      if (info.version) {
        deps.push({ ecosystem: 'npm', name, version: info.version, manifest_path: manifestPath, is_transitive: true });
      }
    }
  } else if (lock.dependencies) {
    // v1 format: recursive dependencies object
    flattenLockDepsV1(lock.dependencies, deps, manifestPath);
  }

  return deps;
}

function flattenLockDepsV1(depsObj, result, manifestPath) {
  for (const [name, info] of Object.entries(depsObj || {})) {
    if (info.version) {
      result.push({ ecosystem: 'npm', name, version: info.version, manifest_path: manifestPath, is_transitive: true });
    }
    if (info.dependencies) {
      flattenLockDepsV1(info.dependencies, result, manifestPath);
    }
  }
}

function parseYarnLock(content, manifestPath) {
  const deps = [];
  // Split on double newlines to get individual package blocks
  const blocks = content.split(/\n\n+/);

  for (const block of blocks) {
    if (!block.trim() || block.trim().startsWith('#')) continue;

    const lines = block.split('\n');
    // Header line(s): "package-name@version, package-name@other-version:"
    // or "__metadata:" etc.
    const headerLine = lines[0];
    if (!headerLine || headerLine.startsWith(' ')) continue;

    // Extract package name from header (before @semver)
    const headerMatch = headerLine.match(/^"?(@?[^@\s"]+)@/);
    // Extract resolved version from "  version X.Y.Z" line
    const versionLine = lines.find(l => l.match(/^\s+version\s+/));
    const versionMatch = versionLine && versionLine.match(/version\s+"?([^"\s]+)"?/);

    if (headerMatch && versionMatch) {
      deps.push({
        ecosystem: 'npm',
        name: headerMatch[1],
        version: versionMatch[1],
        manifest_path: manifestPath,
        is_transitive: true,
      });
    }
  }
  return deps;
}

function parseRequirementsTxt(content, manifestPath) {
  const deps = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip comments, blank lines, options (-r, -c, --index-url, etc.)
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
    // Only exact pinned versions: pkg==1.2.3
    const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*==\s*([^\s;#]+)/);
    if (match) {
      deps.push({
        ecosystem: 'PyPI',
        name: match[1],
        version: match[2],
        manifest_path: manifestPath,
        is_transitive: false,
      });
    }
  }
  return deps;
}

function parsePipfileLock(content, manifestPath) {
  const lock = JSON.parse(content);
  const deps = [];
  for (const section of ['default', 'develop']) {
    if (!lock[section]) continue;
    for (const [name, info] of Object.entries(lock[section])) {
      const version = (info.version || '').replace(/^==/, '');
      if (version) {
        deps.push({ ecosystem: 'PyPI', name, version, manifest_path: manifestPath, is_transitive: false });
      }
    }
  }
  return deps;
}

function parseGoMod(content, manifestPath) {
  const deps = [];

  // Multi-line require block: require ( ... )
  const requireBlockMatch = content.match(/require\s*\(([\s\S]*?)\)/);
  if (requireBlockMatch) {
    for (const line of requireBlockMatch[1].split('\n')) {
      const match = line.trim().match(/^(\S+)\s+(v[\d.]+\S*)/);
      if (match) {
        deps.push({ ecosystem: 'Go', name: match[1], version: match[2], manifest_path: manifestPath, is_transitive: false });
      }
    }
  }

  // Single-line requires: require modulePath vX.Y.Z
  const singleRequireRegex = /^require\s+(\S+)\s+(v[\d.]+\S*)/gm;
  let singleMatch;
  while ((singleMatch = singleRequireRegex.exec(content)) !== null) {
    deps.push({ ecosystem: 'Go', name: singleMatch[1], version: singleMatch[2], manifest_path: manifestPath, is_transitive: false });
  }

  return deps;
}

function parseCargoLock(content, manifestPath) {
  const deps = [];
  // Split on [[package]] blocks
  const packageBlocks = content.split(/\[\[package\]\]/);
  for (const block of packageBlocks) {
    const nameMatch = block.match(/^name\s*=\s*"([^"]+)"/m);
    const versionMatch = block.match(/^version\s*=\s*"([^"]+)"/m);
    if (nameMatch && versionMatch) {
      deps.push({
        ecosystem: 'crates.io',
        name: nameMatch[1],
        version: versionMatch[1],
        manifest_path: manifestPath,
        is_transitive: true,
      });
    }
  }
  return deps;
}

function parseGemfileLock(content, manifestPath) {
  const deps = [];
  // Find "GEM" section > "specs:" block
  const specsMatch = content.match(/GEM[\s\S]*?specs:\n([\s\S]*?)(?:\n\n|\nPLATFORMS|\nDEPENDENCIES|\nBUNDLED)/);
  if (specsMatch) {
    for (const line of specsMatch[1].split('\n')) {
      // Specs are indented 4 spaces: "    gem-name (1.2.3)"
      const match = line.match(/^ {4}(\S+)\s+\(([^)]+)\)/);
      if (match) {
        deps.push({
          ecosystem: 'RubyGems',
          name: match[1],
          version: match[2],
          manifest_path: manifestPath,
          is_transitive: false,
        });
      }
    }
  }
  return deps;
}

function parseCsproj(content, manifestPath) {
  const deps = [];
  // <PackageReference Include="PackageName" Version="1.2.3" />
  // Also handles <PackageReference Include="..." Version="..."></PackageReference>
  const regex = /<PackageReference\s+[^>]*?Include="([^"]+)"[^>]*?Version="([^"]+)"/gi;
  let match;
  while ((match = regex.exec(content)) !== null) {
    deps.push({
      ecosystem: 'NuGet',
      name: match[1],
      version: match[2],
      manifest_path: manifestPath,
      is_transitive: false,
    });
  }
  // Also match Version before Include
  const regex2 = /<PackageReference\s+[^>]*?Version="([^"]+)"[^>]*?Include="([^"]+)"/gi;
  while ((match = regex2.exec(content)) !== null) {
    deps.push({
      ecosystem: 'NuGet',
      name: match[2],
      version: match[1],
      manifest_path: manifestPath,
      is_transitive: false,
    });
  }
  return deps;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strip semver range prefixes (^, ~, >=, <=, =, >, <) from version strings.
 * Returns empty string if the version is a URL, 'workspace:*', etc.
 */
function cleanVersion(ver) {
  if (!ver || typeof ver !== 'string') return '';
  // Skip non-version references (URLs, local paths, workspace ranges)
  if (ver.startsWith('http') || ver.startsWith('file:') || ver.startsWith('workspace:') || ver.startsWith('git+')) return '';
  return ver.replace(/^[\^~>=<]+/, '').trim();
}

module.exports = { isManifestFile, parseManifest, MANIFEST_BASENAMES };
