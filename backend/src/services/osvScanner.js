/**
<<<<<<< HEAD
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
=======
 * OSV Scanner — US-045 Dependency Vulnerability Scanning (SCA)
 *
 * Queries the OSV.dev API for known vulnerabilities in a list of dependencies,
 * using a 24-hour Supabase cache to avoid redundant API calls across repos/users.
 *
 * Design principles:
 *  - Cache-first: checks vulnerability_cache before calling OSV
 *  - Batched: groups uncached deps into batches of 100 for /v1/querybatch
 *  - Enriched: fetches full vuln details (CVSS, CVE IDs, fix versions) via /v1/vulns/{id}
 *  - Best-effort: all errors are caught and logged — never throws to caller
 *  - Non-blocking: wrapping try/catch is the caller's responsibility (done in indexerService)
 */

const { supabaseAdmin } = require('../db/supabase');
const pLimit = require('p-limit');

const OSV_BATCH_URL  = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL   = 'https://api.osv.dev/v1/vulns';
const BATCH_SIZE     = 100;
const CACHE_TTL_HOURS = 24;

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Scan a list of dependencies against OSV.dev and return analysis_issues rows
 * plus per-package results for the Dependencies tab.
 *
 * @param {Array<{ecosystem: string, name: string, version: string, manifest_path: string, is_transitive: boolean}>} deps
 * @param {string} repoId
 * @returns {Promise<{issues: Array, depResults: Array}>}
 */
async function scanDependencies(deps, repoId) {
  const issues     = [];
  const depResults = [];

  try {
    // 1. Deduplicate by (ecosystem, name, version) — only check unique combos
    const seenKeys = new Set();
    const uniqueDeps = [];
    for (const dep of deps) {
      if (!dep.version) continue; // skip deps without a pin
      const key = makeKey(dep);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueDeps.push(dep);
      }
    }

    if (uniqueDeps.length === 0) return { issues, depResults };

    console.log(`[SCA] Scanning ${uniqueDeps.length} unique dependencies...`);

    // 2. Cache lookup: batch fetch all deps in a single query, then filter client-side.
    //    Individual-query approach created N DB round trips for N unique deps.
    const cached   = new Map(); // key -> vulns[]
    const uncached = [];

    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3_600_000).toISOString();

    // Fetch all cache rows for this set of (ecosystem, name, version) tuples in one shot.
    // We page in chunks of 1000 to stay within PostgREST row limits.
    const CACHE_FETCH_SIZE = 1000;
    for (let offset = 0; offset < uniqueDeps.length; offset += CACHE_FETCH_SIZE) {
      const slice = uniqueDeps.slice(offset, offset + CACHE_FETCH_SIZE);
      // Build an OR filter: ecosystem=A&package_name=B&pkg_version=C for each dep.
      // Supabase JS v2 doesn't support multi-column OR natively, so we use a raw
      // .or() with a constructed filter string.
      const orParts = slice.map(d =>
        `and(ecosystem.eq.${d.ecosystem},package_name.eq.${encodeURIComponent(d.name)},pkg_version.eq.${encodeURIComponent(d.version)})`
      );
      // PostgREST OR filter can get very large for huge dependency sets; fall back to
      // individual queries if the slice is small (< 20) to avoid URL-length issues.
      if (slice.length <= 20) {
        // Small slice — individual queries are fine and avoid URL-length issues
        const cacheLimit = pLimit(10);
        await Promise.all(
          slice.map(dep =>
            cacheLimit(async () => {
              const { data } = await supabaseAdmin
                .from('vulnerability_cache')
                .select('ecosystem, package_name, pkg_version, vulns')
                .eq('ecosystem', dep.ecosystem)
                .eq('package_name', dep.name)
                .eq('pkg_version', dep.version)
                .gt('created_at', cutoff)
                .maybeSingle();
              if (data) cached.set(makeKey(dep), data.vulns);
            })
          )
        );
      } else {
        // Larger slice — use a single query with an OR filter string.
        // We match on all three columns for each dep tuple.
        const { data: rows } = await supabaseAdmin
          .from('vulnerability_cache')
          .select('ecosystem, package_name, pkg_version, vulns')
          .or(orParts.join(','))
          .gt('created_at', cutoff);

        for (const row of (rows || [])) {
          const key = `${row.ecosystem}::${row.package_name}::${row.pkg_version}`;
          cached.set(key, row.vulns);
        }
      }
    }

    for (const dep of uniqueDeps) {
      if (!cached.has(makeKey(dep))) {
        uncached.push(dep);
      }
    }

    console.log(`[SCA] Cache hits: ${cached.size} | OSV queries needed: ${uncached.length}`);

    // 3. Query OSV in batches for uncached deps — run up to 5 batches concurrently
    const osvVulnIds = new Map(); // key -> vulnId[]

    const osvBatches = chunkArray(uncached, BATCH_SIZE);
    const batchLimit = pLimit(5);
    await Promise.all(
      osvBatches.map((batch, batchIndex) =>
        batchLimit(async () => {
          try {
            const queries = batch.map(d => ({
              package: { name: d.name, ecosystem: d.ecosystem },
              version: d.version,
            }));

            const res = await fetch(OSV_BATCH_URL, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ queries }),
            });

            if (!res.ok) {
              console.warn(`[SCA] OSV batch ${batchIndex} returned HTTP ${res.status} — skipping`);
              for (const dep of batch) osvVulnIds.set(makeKey(dep), []);
              return;
            }

            const { results } = await res.json();
            for (let i = 0; i < batch.length; i++) {
              const key     = makeKey(batch[i]);
              const vulnIds = (results[i]?.vulns || []).map(v => v.id);
              osvVulnIds.set(key, vulnIds);
            }
          } catch (err) {
            console.warn(`[SCA] OSV batch ${batchIndex} failed: ${err.message} — skipping`);
            for (const dep of batch) osvVulnIds.set(makeKey(dep), []);
          }
        })
      )
    );

    // 4. Collect all unique vuln IDs that need detail enrichment
    const allVulnIds = new Set();
    for (const ids of osvVulnIds.values()) {
      ids.forEach(id => allVulnIds.add(id));
    }

    // 5. Fetch full vuln details concurrently (limit 15 in-flight)
    const vulnDetails = new Map(); // vulnId -> detail object
    if (allVulnIds.size > 0) {
      const detailLimit = pLimit(15);
      await Promise.all(
        [...allVulnIds].map(vulnId =>
          detailLimit(async () => {
            try {
              const res = await fetch(`${OSV_VULN_URL}/${vulnId}`);
              if (res.ok) {
                vulnDetails.set(vulnId, await res.json());
              }
            } catch (err) {
              console.warn(`[SCA] Failed to fetch detail for ${vulnId}: ${err.message}`);
            }
          })
        )
      );
    }

    // 6. Enrich and build cache rows for newly-fetched deps
    const cacheRowsToWrite = [];
    for (const dep of uncached) {
      const key     = makeKey(dep);
      const vulnIds = osvVulnIds.get(key) || [];

      const enriched = vulnIds.map(id => {
        const detail = vulnDetails.get(id);
        if (!detail) return { id, severity: 'medium', summary: '', aliases: [], fixedVersion: null, advisoryUrl: `https://osv.dev/vulnerability/${id}` };

        const cvss         = extractCvssScore(detail);
        const aliases      = (detail.aliases || []).filter(a => a.startsWith('CVE-'));
        const fixedVersion = extractFixedVersion(detail, dep.ecosystem, dep.name);

        return {
          id,
          aliases,
          summary:      detail.summary || '',
          severity:     cvssToSeverity(cvss),
          cvss,
          fixedVersion,
          advisoryUrl:  `https://osv.dev/vulnerability/${id}`,
        };
      });

      cached.set(key, enriched);
      cacheRowsToWrite.push({
        ecosystem:    dep.ecosystem,
        package_name: dep.name,
        pkg_version:  dep.version,
        vulns:        enriched,
      });
    }

    // 7. Upsert newly-fetched results to cache
    if (cacheRowsToWrite.length > 0) {
      const cacheWriteBatches = chunkArray(cacheRowsToWrite, 200);
      for (const batch of cacheWriteBatches) {
        const { error } = await supabaseAdmin
          .from('vulnerability_cache')
          .upsert(batch, { onConflict: 'ecosystem,package_name,pkg_version', ignoreDuplicates: false });
        if (error) console.warn(`[SCA] Cache write error: ${error.message}`);
      }
    }

    // 8. Build issues + depResults for ALL deps (using the now-populated cache map)
    for (const dep of deps) {
      if (!dep.version) continue;
      const key  = makeKey(dep);
      const vulns = cached.get(key) || [];

      depResults.push({
        manifest_path: dep.manifest_path,
        ecosystem:     dep.ecosystem,
        package_name:  dep.name,
        version:       dep.version,
        is_transitive: dep.is_transitive,
        vuln_count:    vulns.length,
        vulns_json:    vulns,
      });

      for (const vuln of vulns) {
        const cveId   = (vuln.aliases && vuln.aliases.length > 0) ? vuln.aliases[0] : vuln.id;
        const fixedStr = vuln.fixedVersion ? ` — upgrade to ${vuln.fixedVersion}` : '';

        issues.push({
          repo_id:     repoId,
          type:        'vulnerable_dependency',
          severity:    vuln.severity || 'medium',
          file_paths:  [dep.manifest_path],
          description: `${cveId}: ${dep.name}@${dep.version} has a known vulnerability (${vuln.summary || vuln.id})${fixedStr}. Advisory: ${vuln.advisoryUrl}`,
        });
      }
    }

    console.log(`[SCA] Scan complete — ${issues.length} vulnerability issues found across ${deps.length} dependencies.`);
  } catch (err) {
    console.warn(`[SCA] Dependency vulnerability scan failed (best-effort): ${err.message}`);
  }

  return { issues, depResults };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeKey(dep) {
  return `${dep.ecosystem}::${dep.name}::${dep.version}`;
}

/**
 * Extract a CVSS numeric score (0–10) from an OSV vulnerability detail object.
 * Falls back to ecosystem_specific.severity, then defaults to 5 (medium).
 */
function extractCvssScore(vulnDetail) {
  // Check top-level severity array (OSV schema v1.3+)
  if (Array.isArray(vulnDetail.severity)) {
    for (const s of vulnDetail.severity) {
      // CVSS_V3 score field is the CVSS vector string; numeric score often in database_specific
      if ((s.type === 'CVSS_V3' || s.type === 'CVSS_V2') && s.score) {
        // Try to parse the base score if encoded in the vector
        // Some OSV records embed numeric score in database_specific
        break;
      }
    }
  }

  // Check affected[].ecosystem_specific.severity (GitHub Advisory style)
  if (Array.isArray(vulnDetail.affected)) {
    for (const affected of vulnDetail.affected) {
      const sev = affected.ecosystem_specific?.severity ||
                  affected.database_specific?.severity;
      if (sev) {
        const upper = sev.toUpperCase();
        if (upper === 'CRITICAL') return 9;
        if (upper === 'HIGH')     return 8;
        if (upper === 'MODERATE' || upper === 'MEDIUM') return 5.5;
        if (upper === 'LOW')      return 2;
      }
    }
  }

  // Default: treat as medium
  return 5;
}

/**
 * Derive severity label from a CVSS numeric score.
 * Thresholds: low < 4, medium 4–7, high > 7
 */
function cvssToSeverity(score) {
  if (score < 4) return 'low';
  if (score <= 7) return 'medium';
  return 'high';
}

/**
 * Find the lowest fixed version for a given package in an OSV vulnerability detail.
 */
function extractFixedVersion(vulnDetail, ecosystem, packageName) {
  if (!Array.isArray(vulnDetail.affected)) return null;
  for (const affected of vulnDetail.affected) {
    if (affected.package?.name !== packageName) continue;
    if (affected.package?.ecosystem !== ecosystem) continue;
    for (const range of (affected.ranges || [])) {
      for (const event of (range.events || [])) {
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
        if (event.fixed) return event.fixed;
      }
    }
  }
  return null;
}

<<<<<<< HEAD
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
=======
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

module.exports = { scanDependencies };
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
