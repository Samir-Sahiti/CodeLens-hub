/**
 * backend/src/services/dependencyFixer.js
 *
 * Deterministic dependency-update service (US-083).
 * Updates a package manifest + lockfile in memory, returning the patched files.
 * No shell-out; uses @npmcli/arborist for npm and @yarnpkg/lockfile for yarn.
 *
 * Exported function:
 *   fixNpmDependency({ manifest_content, lockfile_content, lockfile_format,
 *                       package_name, target_version, strategy })
 *   → Promise<{ ok: true, new_manifest, new_lockfile, applied_changes }
 *           | { ok: false, reason }>
 */

const os   = require('os');
const fs   = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const TIMEOUT_MS = 30_000;

// ── helpers ──────────────────────────────────────────────────────────────────

function safeJson(content) {
  try { return { ok: true, data: JSON.parse(content) }; }
  catch { return { ok: false }; }
}

/** Compute a diff of changed dependency versions between old and new manifests. */
function computeAppliedChanges(oldManifest, newManifest) {
  const changes = [];
  const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides'];
  for (const field of depFields) {
    const oldDeps = oldManifest[field] || {};
    const newDeps = newManifest[field] || {};
    const allKeys = new Set([...Object.keys(oldDeps), ...Object.keys(newDeps)]);
    for (const pkg of allKeys) {
      const from = oldDeps[pkg];
      const to   = newDeps[pkg];
      if (from !== to) {
        changes.push({
          package: pkg,
          from: from || null,
          to:   to   || null,
          kind: field === 'overrides' ? 'override' : (oldManifest.dependencies?.[pkg] || oldManifest.devDependencies?.[pkg] ? 'direct' : 'transitive'),
        });
      }
    }
  }
  return changes;
}

// ── npm path ─────────────────────────────────────────────────────────────────

async function fixWithArborist({ manifest_content, lockfile_content, package_name, target_version }) {
  const Arborist = require('@npmcli/arborist');

  const { ok, data: manifest } = safeJson(manifest_content);
  if (!ok) return { ok: false, reason: 'malformed_manifest_json' };

  const updatedManifest = JSON.parse(JSON.stringify(manifest));

  // Determine if it's a direct dep or transitive
  const isDirectDep = Boolean(
    updatedManifest.dependencies?.[package_name] ||
    updatedManifest.devDependencies?.[package_name] ||
    updatedManifest.peerDependencies?.[package_name] ||
    updatedManifest.optionalDependencies?.[package_name]
  );

  if (isDirectDep) {
    // Update the version range in whichever field it lives in
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (updatedManifest[field]?.[package_name] !== undefined) {
        updatedManifest[field][package_name] = target_version;
      }
    }
  } else {
    // Transitive: use npm overrides
    if (!updatedManifest.overrides) updatedManifest.overrides = {};
    updatedManifest.overrides[package_name] = target_version;
  }

  // Write to a tmpdir so Arborist can reify
  const tmpDir = path.join(os.tmpdir(), `codelens-fix-${crypto.randomUUID()}`);
  try {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(updatedManifest, null, 2), 'utf8');
    if (lockfile_content) {
      await fs.writeFile(path.join(tmpDir, 'package-lock.json'), lockfile_content, 'utf8');
    }

    const arborist = new Arborist({ path: tmpDir });

    await Promise.race([
      arborist.reify({ save: true, audit: false }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('arborist_timeout')), TIMEOUT_MS)
      ),
    ]);

    const newManifestStr  = await fs.readFile(path.join(tmpDir, 'package.json'), 'utf8');
    let   newLockfileStr  = null;
    try {
      newLockfileStr = await fs.readFile(path.join(tmpDir, 'package-lock.json'), 'utf8');
    } catch { /* lock may not exist for zip-only repos */ }

    const { ok: parsedOk, data: newManifest } = safeJson(newManifestStr);
    if (!parsedOk) return { ok: false, reason: 'arborist_produced_invalid_manifest' };

    return {
      ok: true,
      new_manifest:  newManifestStr,
      new_lockfile:  newLockfileStr,
      applied_changes: computeAppliedChanges(manifest, newManifest),
    };
  } catch (err) {
    if (err.message === 'arborist_timeout') return { ok: false, reason: 'timeout' };
    // Peer dep conflict, major version break, etc.
    return { ok: false, reason: err.message || 'arborist_reify_failed' };
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── yarn path ─────────────────────────────────────────────────────────────────

async function fixWithYarn({ manifest_content, lockfile_content, package_name, target_version }) {
  const yarnLockfile = require('@yarnpkg/lockfile');

  const { ok, data: manifest } = safeJson(manifest_content);
  if (!ok) return { ok: false, reason: 'malformed_manifest_json' };

  const updatedManifest = JSON.parse(JSON.stringify(manifest));

  // Update direct dep in manifest (same logic as npm)
  const isDirectDep = Boolean(
    updatedManifest.dependencies?.[package_name] ||
    updatedManifest.devDependencies?.[package_name]
  );
  if (isDirectDep) {
    for (const field of ['dependencies', 'devDependencies']) {
      if (updatedManifest[field]?.[package_name] !== undefined) {
        updatedManifest[field][package_name] = target_version;
      }
    }
  }

  if (!lockfile_content) {
    // No lockfile — just return the updated manifest
    return {
      ok: true,
      new_manifest:  JSON.stringify(updatedManifest, null, 2),
      new_lockfile:  null,
      applied_changes: computeAppliedChanges(manifest, updatedManifest),
    };
  }

  // Parse the lockfile
  const parsed = yarnLockfile.parse(lockfile_content);
  if (parsed.type !== 'success') {
    return { ok: false, reason: 'yarn_lockfile_parse_failed' };
  }

  const lockfileObj = parsed.object;

  // Count distinct resolution versions for the package to detect complex graphs
  const matchingEntries = Object.keys(lockfileObj).filter(key =>
    key.startsWith(`${package_name}@`)
  );
  const distinctResolutions = new Set(matchingEntries.map(k => lockfileObj[k]?.version)).size;
  if (distinctResolutions > 1) {
    return { ok: false, reason: 'yarn_complex_resolution' };
  }

  // Update version for all entries matching the package
  let changed = false;
  for (const key of matchingEntries) {
    if (lockfileObj[key]) {
      lockfileObj[key].version   = target_version;
      lockfileObj[key].resolved  = lockfileObj[key].resolved
        ? lockfileObj[key].resolved.replace(/[^/]+\.tgz$/, `${package_name}-${target_version}.tgz`)
        : lockfileObj[key].resolved;
      changed = true;
    }
  }

  if (!changed && !isDirectDep) {
    return { ok: false, reason: 'package_not_found_in_lockfile' };
  }

  const newLockfileStr = yarnLockfile.stringify(lockfileObj);

  return {
    ok: true,
    new_manifest:  JSON.stringify(updatedManifest, null, 2),
    new_lockfile:  newLockfileStr,
    applied_changes: computeAppliedChanges(manifest, updatedManifest),
  };
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.manifest_content  - Raw package.json / pyproject.toml etc.
 * @param {string|null} opts.lockfile_content - Raw lockfile (package-lock.json / yarn.lock) or null
 * @param {'npm'|'yarn'|'pnpm'} opts.lockfile_format
 * @param {string} opts.package_name      - Package to upgrade
 * @param {string} opts.target_version    - Target version spec (e.g. "^4.17.21" or "4.17.21")
 * @param {'minimum_safe'|'latest_safe'} opts.strategy - Informational; affects caller context
 * @returns {Promise<{ok:true, new_manifest:string, new_lockfile:string|null, applied_changes:Array}
 *                  |{ok:false, reason:string}>}
 */
async function fixNpmDependency({ manifest_content, lockfile_content, lockfile_format, package_name, target_version }) {
  if (!manifest_content) return { ok: false, reason: 'missing_manifest_content' };
  if (!package_name)      return { ok: false, reason: 'missing_package_name' };
  if (!target_version)    return { ok: false, reason: 'missing_target_version' };

  if (lockfile_format === 'npm') {
    return fixWithArborist({ manifest_content, lockfile_content, package_name, target_version });
  }

  if (lockfile_format === 'yarn') {
    return fixWithYarn({ manifest_content, lockfile_content, package_name, target_version });
  }

  if (lockfile_format === 'pnpm') {
    return { ok: false, reason: 'pnpm_not_yet_supported' };
  }

  return { ok: false, reason: `unsupported_lockfile_format:${lockfile_format}` };
}

module.exports = { fixNpmDependency };
