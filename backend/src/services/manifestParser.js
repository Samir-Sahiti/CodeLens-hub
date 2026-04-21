/**
 * Manifest Parser — extracts (ecosystem, name, version) tuples from
 * dependency manifests found in indexed files.
 *
 * Supported:
 *   npm     — package.json, package-lock.json (v1/v2/v3), yarn.lock
 *   pypi    — requirements.txt, Pipfile.lock
 *   go      — go.mod
 *   cargo   — Cargo.lock
 *   rubygems— Gemfile.lock
 *   nuget   — *.csproj
 */

/**
 * @typedef {{ ecosystem: string, name: string, version: string, isDirect?: boolean, manifestPath: string }} Dep
 */

// ── npm / package.json ────────────────────────────────────────────────────────

function parsePackageJson(content, filePath) {
  const deps = [];
  try {
    const pkg = JSON.parse(content);
    const sections = [
      ...(pkg.dependencies     ? Object.entries(pkg.dependencies)     : []),
      ...(pkg.devDependencies  ? Object.entries(pkg.devDependencies)  : []),
      ...(pkg.peerDependencies ? Object.entries(pkg.peerDependencies) : []),
    ];
    for (const [name, raw] of sections) {
      const version = cleanSemver(raw);
      if (version) deps.push({ ecosystem: 'npm', name, version, isDirect: true, manifestPath: filePath });
    }
  } catch (e) {
    // malformed JSON — skip
  }
  return deps;
}

function parsePackageLockJson(content, filePath) {
  const deps = [];
  try {
    const lock = JSON.parse(content);
    // v3: packages map (key = "node_modules/foo")
    if (lock.packages) {
      for (const [key, pkg] of Object.entries(lock.packages)) {
        if (!key || key === '') continue; // root
        const name = pkg.name || key.replace(/^node_modules\//, '').replace(/.*node_modules\//, '');
        const version = pkg.version;
        if (name && version) {
          deps.push({ ecosystem: 'npm', name, version, isDirect: false, manifestPath: filePath });
        }
      }
    } else if (lock.dependencies) {
      // v1/v2: flatten recursively
      flattenLockDeps(lock.dependencies, filePath, deps);
    }
  } catch (e) {
    // skip
  }
  return deps;
}

function flattenLockDeps(obj, filePath, acc) {
  for (const [name, data] of Object.entries(obj || {})) {
    if (data.version) {
      acc.push({ ecosystem: 'npm', name, version: data.version, isDirect: false, manifestPath: filePath });
    }
    if (data.dependencies) flattenLockDeps(data.dependencies, filePath, acc);
  }
}

function parseYarnLock(content, filePath) {
  const deps = [];
  // Yarn classic (v1) format: "name@range:" followed by "  version: \"x.y.z\""
  // Yarn berry (v2/v3) uses the same rough pattern but has different header
  const blockRegex = /^"?([^@\n"]+)@[^:]+:"?\s*\n(?:[^\n]*\n)*?\s+version:? "?([^\n"]+)"?/gm;
  let m;
  while ((m = blockRegex.exec(content)) !== null) {
    const name = m[1].trim();
    const version = m[2].trim();
    if (name && version) {
      deps.push({ ecosystem: 'npm', name, version, isDirect: false, manifestPath: filePath });
    }
  }
  return deps;
}

// ── PyPI ─────────────────────────────────────────────────────────────────────

function parseRequirementsTxt(content, filePath) {
  const deps = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line || line.startsWith('-') || line.startsWith('http')) continue;
    // Handle: name==1.2.3, name>=1.2.3, name~=1.2.3, name[extra]==1.2.3
    const m = line.match(/^([A-Za-z0-9_.[\]-]+?)==([^\s,;]+)/);
    if (m) {
      const name = m[1].replace(/\[.*\]/, '').trim();
      deps.push({ ecosystem: 'PyPI', name, version: m[2], isDirect: true, manifestPath: filePath });
    } else {
      // No pinned version — we can't query OSV without one
      const nameOnly = line.match(/^([A-Za-z0-9_.+-]+)/);
      if (nameOnly) {
        deps.push({ ecosystem: 'PyPI', name: nameOnly[1], version: '', isDirect: true, manifestPath: filePath });
      }
    }
  }
  return deps;
}

function parsePipfileLock(content, filePath) {
  const deps = [];
  try {
    const lock = JSON.parse(content);
    for (const section of ['default', 'develop']) {
      for (const [name, data] of Object.entries(lock[section] || {})) {
        const version = (data.version || '').replace('==', '').trim();
        if (version) {
          deps.push({ ecosystem: 'PyPI', name, version, isDirect: true, manifestPath: filePath });
        }
      }
    }
  } catch (e) { /* skip */ }
  return deps;
}

// ── Go ────────────────────────────────────────────────────────────────────────

function parseGoMod(content, filePath) {
  const deps = [];
  const requireBlock = /require\s*\(([\s\S]*?)\)/g;
  const singleRequire = /^require\s+(\S+)\s+(\S+)/gm;

  let m;
  while ((m = requireBlock.exec(content)) !== null) {
    for (const line of m[1].split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && !parts[0].startsWith('//')) {
        const version = parts[1].replace(/^v/, '');
        deps.push({ ecosystem: 'Go', name: parts[0], version, isDirect: true, manifestPath: filePath });
      }
    }
  }
  while ((m = singleRequire.exec(content)) !== null) {
    const version = m[2].replace(/^v/, '');
    deps.push({ ecosystem: 'Go', name: m[1], version, isDirect: true, manifestPath: filePath });
  }
  return deps;
}

// ── Cargo ─────────────────────────────────────────────────────────────────────

function parseCargoLock(content, filePath) {
  const deps = [];
  const packageBlocks = content.split(/\[\[package\]\]/g).slice(1);
  for (const block of packageBlocks) {
    const nameM   = block.match(/name\s*=\s*"([^"]+)"/);
    const versionM = block.match(/version\s*=\s*"([^"]+)"/);
    if (nameM && versionM) {
      deps.push({ ecosystem: 'crates.io', name: nameM[1], version: versionM[1], isDirect: false, manifestPath: filePath });
    }
  }
  return deps;
}

// ── RubyGems ──────────────────────────────────────────────────────────────────

function parseGemfileLock(content, filePath) {
  const deps = [];
  let inGem = false;
  for (const line of content.split('\n')) {
    if (line.startsWith('GEM') || line.startsWith('PATH') || line.startsWith('GIT')) {
      inGem = true; continue;
    }
    if (line.startsWith('PLATFORMS') || line.startsWith('DEPENDENCIES') || line.startsWith('BUNDLED')) {
      inGem = false; continue;
    }
    if (inGem) {
      const m = line.match(/^\s{4}([A-Za-z0-9_\-.]+)\s+\(([^)]+)\)/);
      if (m) {
        const version = m[2].split(',')[0].trim(); // pick lowest/first
        deps.push({ ecosystem: 'RubyGems', name: m[1], version, isDirect: false, manifestPath: filePath });
      }
    }
  }
  return deps;
}

// ── NuGet / .csproj ───────────────────────────────────────────────────────────

function parseCsproj(content, filePath) {
  const deps = [];
  const refRegex = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/gi;
  let m;
  while ((m = refRegex.exec(content)) !== null) {
    const version = cleanSemver(m[2]);
    if (version) deps.push({ ecosystem: 'NuGet', name: m[1], version, isDirect: true, manifestPath: filePath });
  }
  return deps;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanSemver(raw = '') {
  // Strip leading ^~>=<*, keep first concrete version-like string
  const m = (raw || '').match(/(\d+\.\d+[.\d]*)/);
  return m ? m[1] : null;
}

/**
 * Given a file path and its content, returns an array of Dep objects.
 * Returns null if the file is not a recognised manifest.
 *
 * @param {string} filePath
 * @param {string} content
 * @returns {Dep[] | null}
 */
function parseManifest(filePath, content) {
  const base = filePath.split('/').pop().toLowerCase();

  if (base === 'package.json')       return parsePackageJson(content, filePath);
  if (base === 'package-lock.json')  return parsePackageLockJson(content, filePath);
  if (base === 'yarn.lock')          return parseYarnLock(content, filePath);
  if (base === 'requirements.txt')   return parseRequirementsTxt(content, filePath);
  if (base === 'pipfile.lock')       return parsePipfileLock(content, filePath);
  if (base === 'go.mod')             return parseGoMod(content, filePath);
  if (base === 'cargo.lock')         return parseCargoLock(content, filePath);
  if (base === 'gemfile.lock')       return parseGemfileLock(content, filePath);
  if (base.endsWith('.csproj'))      return parseCsproj(content, filePath);

  return null; // not a manifest
}

/** True if this file path might be a manifest worth fetching */
function isManifestPath(filePath) {
  const base = filePath.split('/').pop().toLowerCase();
  return (
    base === 'package.json' ||
    base === 'package-lock.json' ||
    base === 'yarn.lock' ||
    base === 'requirements.txt' ||
    base === 'pipfile.lock' ||
    base === 'go.mod' ||
    base === 'cargo.lock' ||
    base === 'gemfile.lock' ||
    base.endsWith('.csproj')
  );
}

module.exports = { parseManifest, isManifestPath };
