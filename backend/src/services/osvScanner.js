/**
 * OSV Vulnerability Scanner — US-045
 *
 * Queries https://api.osv.dev/v1/querybatch for each unique
 * (ecosystem, name, version) tuple found in dependency manifests.
 *
 * Results are cached in the `vulnerability_cache` Supabase table
 * keyed on (ecosystem, name, version), TTL = 24 hours.
 */

const { supabaseAdmin } = require('../db/supabase');

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const BATCH_SIZE    = 100;   // OSV supports up to 1000; stay conservative
const CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24 hours

// ── CVSS → severity mapping ────────────────────────────────────────────────

function cvssToSeverity(score) {
  if (score === null || score === undefined) return 'medium';
  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

/** Extract the best CVSS score from an OSV vulnerability object */
function extractCvssScore(vuln) {
  // OSV severity array: [{ type: "CVSS_V3", score: "CVSS:3.1/..." }]
  // Also check database-specific fields
  const severities = vuln.severity || [];
  for (const s of severities) {
    if (s.type === 'CVSS_V3' || s.type === 'CVSS_V2') {
      const m = (s.score || '').match(/\/(\d+(\.\d+)?)$/);
      if (m) return parseFloat(m[1]);
    }
  }
  // Fallback: check database_specific.cvss_v3 or similar
  const db = vuln.database_specific || {};
  if (db.cvss_v3) {
    const s = parseFloat(db.cvss_v3.base_score || db.cvss_v3);
    if (!isNaN(s)) return s;
  }
  if (db.severity) {
    // Sometimes it's a string like "HIGH"
    const str = String(db.severity).toUpperCase();
    if (str === 'CRITICAL' || str === 'HIGH')   return 8.0;
    if (str === 'MEDIUM')                         return 5.0;
    if (str === 'LOW')                            return 2.0;
  }
  // ecosystem_specific fallbacks
  const eco = vuln.ecosystem_specific || {};
  if (eco.severity) {
    const str = String(eco.severity).toUpperCase();
    if (str === 'CRITICAL' || str === 'HIGH')   return 8.0;
    if (str === 'MEDIUM')                         return 5.0;
    if (str === 'LOW')                            return 2.0;
  }
  return null;
}

/** Extracts the first CVE id from aliases if available */
function extractCve(vuln) {
  const aliases = vuln.aliases || [];
  return aliases.find(a => a.startsWith('CVE-')) || vuln.id || 'Unknown';
}

/** Extracts the lowest fixed version from affected[].ranges[].events */
function extractFixedVersion(vuln) {
  for (const affected of vuln.affected || []) {
    for (const range of affected.ranges || []) {
      for (const event of range.events || []) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return null;
}

// ── Cache helpers ──────────────────────────────────────────────────────────

async function getCachedResult(ecosystem, name, version) {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('vulnerability_cache')
    .select('vulns_json')
    .eq('ecosystem', ecosystem)
    .eq('package_name', name)
    .eq('package_version', version)
    .gte('cached_at', cutoff)
    .maybeSingle();

  if (error || !data) return null;
  try {
    return JSON.parse(data.vulns_json);
  } catch {
    return null;
  }
}

async function setCachedResult(ecosystem, name, version, vulns) {
  const { error } = await supabaseAdmin
    .from('vulnerability_cache')
    .upsert(
      {
        ecosystem,
        package_name: name,
        package_version: version,
        vulns_json: JSON.stringify(vulns),
        cached_at: new Date().toISOString(),
      },
      { onConflict: 'ecosystem,package_name,package_version', ignoreDuplicates: false }
    );
  if (error) {
    console.warn('[osv] Cache write failed:', error.message);
  }
}

// ── OSV batch fetch ────────────────────────────────────────────────────────

/**
 * Fetch vulnerabilities for an array of { ecosystem, name, version } objects
 * from OSV, respecting the 24-hour cache.
 *
 * Returns a Map keyed on `${ecosystem}:${name}:${version}` → vulns array
 */
async function fetchVulnerabilities(deps) {
  if (!deps || deps.length === 0) return new Map();

  // Deduplicate
  const unique = new Map();
  for (const d of deps) {
    if (!d.version) continue;
    const key = `${d.ecosystem}:${d.name}:${d.version}`;
    if (!unique.has(key)) unique.set(key, d);
  }

  const results = new Map();

  // Check cache first
  const uncached = [];
  for (const [key, dep] of unique) {
    const cached = await getCachedResult(dep.ecosystem, dep.name, dep.version);
    if (cached !== null) {
      results.set(key, cached);
    } else {
      uncached.push({ key, dep });
    }
  }

  if (uncached.length === 0) return results;

  // Batch the uncached queries
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const queries = batch.map(({ dep }) => ({
      package: { name: dep.name, ecosystem: dep.ecosystem },
      version: dep.version,
    }));

    try {
      const resp = await fetch(OSV_BATCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries }),
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        console.warn(`[osv] HTTP ${resp.status} from OSV — skipping batch`);
        for (const { key, dep } of batch) {
          results.set(key, []);
          await setCachedResult(dep.ecosystem, dep.name, dep.version, []);
        }
        continue;
      }

      const body = await resp.json();
      const responseItems = body.results || [];

      for (let j = 0; j < batch.length; j++) {
        const { key, dep } = batch[j];
        const item = responseItems[j] || {};
        const vulns = item.vulns || [];
        results.set(key, vulns);
        await setCachedResult(dep.ecosystem, dep.name, dep.version, vulns);
      }
    } catch (err) {
      console.warn('[osv] Batch query failed:', err.message, '— SCA results may be incomplete');
      for (const { key } of batch) {
        results.set(key, []);
        // Don't cache failures so next run retries
      }
    }
  }

  return results;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Given an array of Dep objects (from manifestParser) and a repoId,
 * returns an array of analysis_issues rows ready for insertion.
 *
 * @param {string} repoId
 * @param {import('./manifestParser').Dep[]} deps
 * @returns {Promise<object[]>}
 */
async function scanDependencies(repoId, deps) {
  const issues = [];
  if (!deps || deps.length === 0) return issues;

  // Filter out deps with no version (requirements.txt without lockfile)
  const scannable = deps.filter(d => d.version);

  let vulnMap;
  try {
    vulnMap = await fetchVulnerabilities(scannable);
  } catch (err) {
    console.warn('[osv] fetchVulnerabilities threw unexpectedly:', err.message);
    return issues; // best-effort
  }

  for (const dep of scannable) {
    const key = `${dep.ecosystem}:${dep.name}:${dep.version}`;
    const vulns = vulnMap.get(key) || [];

    for (const vuln of vulns) {
      const cvssScore  = extractCvssScore(vuln);
      const severity   = cvssToSeverity(cvssScore);
      const cveId      = extractCve(vuln);
      const fixedVer   = extractFixedVersion(vuln);
      const advisoryUrl = `https://osv.dev/vulnerability/${vuln.id}`;

      const fixNote = fixedVer
        ? `Fixed in ${dep.name}@${fixedVer}.`
        : 'No fix available yet.';

      const description =
        `${cveId} — ${dep.ecosystem} package "${dep.name}@${dep.version}" has a known vulnerability. ` +
        `${fixNote} Advisory: ${advisoryUrl}` +
        (cvssScore !== null ? ` (CVSS: ${cvssScore.toFixed(1)})` : '');

      issues.push({
        repo_id:     repoId,
        type:        'vulnerable_dependency',
        severity,
        file_paths:  [dep.manifestPath],
        description,
      });
    }
  }

  return issues;
}

/**
 * Summarises dep scan results into a per-manifest map for the Dependencies tab.
 * Returns:
 * {
 *   [manifestPath]: {
 *     ecosystem: string,
 *     deps: Array<{ name, version, vulnCount, severity, isDirect }>
 *   }
 * }
 */
async function buildDependencyReport(deps) {
  if (!deps || deps.length === 0) return {};

  const scannable = deps.filter(d => d.version);
  let vulnMap;
  try {
    vulnMap = await fetchVulnerabilities(scannable);
  } catch {
    vulnMap = new Map();
  }

  const report = {};
  for (const dep of deps) {
    if (!report[dep.manifestPath]) {
      report[dep.manifestPath] = { ecosystem: dep.ecosystem, deps: [] };
    }
    const key = `${dep.ecosystem}:${dep.name}:${dep.version}`;
    const vulns = dep.version ? (vulnMap.get(key) || []) : [];

    let worstSeverity = 'clean';
    if (vulns.length > 0) {
      const scores = vulns.map(v => extractCvssScore(v));
      const max    = Math.max(...scores.filter(s => s !== null).map(Number));
      worstSeverity = cvssToSeverity(isFinite(max) ? max : null);
    }

    report[dep.manifestPath].deps.push({
      name:      dep.name,
      version:   dep.version || '(unpinned)',
      vulnCount: vulns.length,
      severity:  worstSeverity,
      isDirect:  dep.isDirect !== false,
    });
  }
  return report;
}

module.exports = { scanDependencies, buildDependencyReport, fetchVulnerabilities };
