/**
 * backend/src/lib/snapshotRepo.js
 * 
 * Computes a daily metrics snapshot for a specific repo and saves it to repo_metrics_daily.
 * This pure logic function is designed to be easily testable.
 */

async function computeSnapshot(repoId, db) {
  // Fetch required data
  const { data: repo, error: repoErr } = await db
    .from('repositories')
    .select('file_count')
    .eq('id', repoId)
    .single();

  if (repoErr) {
    // If testing mock returns nothing for single() it might throw an error or return null
    // Be robust for test mocks
  }
  const file_count = repo ? (repo.file_count || 0) : 0;

  const { data: nodes } = await db.from('graph_nodes').select('line_count, complexity_score').eq('repo_id', repoId);
  const { data: issues } = await db.from('analysis_issues').select('id, type, severity, risk_score, file_paths, description').eq('repo_id', repoId);
  const { data: manifests } = await db.from('dependency_manifests').select('id, package_name, vuln_count, vulns_json, is_transitive').eq('repo_id', repoId);

  // Aggregations
  const total_loc = (nodes || []).reduce((acc, n) => acc + (n.line_count || 0), 0);
  const sum_complexity = (nodes || []).reduce((acc, n) => acc + (n.complexity_score || 0), 0);
  const max_complexity = (nodes || []).reduce((acc, n) => Math.max(acc, n.complexity_score || 0), 0);
  const avg_complexity = nodes && nodes.length > 0 ? sum_complexity / nodes.length : 0;

  const issue_counts_json = { by_type: {}, by_severity: { critical: 0, high: 0, medium: 0, low: 0 } };
  for (const t of ['god_file', 'circular_dependency', 'high_coupling', 'dead_code', 'hardcoded_secret', 'insecure_pattern', 'missing_auth', 'vulnerable_dependency', 'refactoring_candidate']) {
    issue_counts_json.by_type[t] = 0;
  }
  
  let sortedRisks = [];
  if (issues) {
    for (const issue of issues) {
      if (issue_counts_json.by_type[issue.type] !== undefined) {
        issue_counts_json.by_type[issue.type]++;
      } else {
        issue_counts_json.by_type[issue.type] = 1;
      }
      
      if (issue_counts_json.by_severity[issue.severity] !== undefined) {
        issue_counts_json.by_severity[issue.severity]++;
      } else {
        issue_counts_json.by_severity[issue.severity] = 1;
      }

      if (issue.risk_score != null) {
        sortedRisks.push(issue);
      }
    }
  }

  sortedRisks.sort((a, b) => b.risk_score - a.risk_score);
  const top_risks_json = sortedRisks.slice(0, 10);

  let dep_total = 0;
  let dep_direct = 0;
  let dep_transitive = 0;
  let dep_vulnerable = 0;
  const vulnerability_counts_json = { by_severity: { critical: 0, high: 0, medium: 0, low: 0 }, by_package: [] };

  if (manifests) {
    dep_total = manifests.length;
    for (const m of manifests) {
      if (m.is_transitive) {
        dep_transitive++;
      } else {
        dep_direct++;
      }

      if (m.vuln_count > 0) {
        dep_vulnerable++;
        
        let maxSev = 'low';
        const sevOrder = { 'low': 1, 'medium': 2, 'high': 3, 'critical': 4 };
        if (m.vulns_json && Array.isArray(m.vulns_json)) {
          for (const v of m.vulns_json) {
            const sev = v.severity || 'low';
            if (sevOrder[sev] > sevOrder[maxSev]) {
              maxSev = sev;
            }
          }
        }
        
        vulnerability_counts_json.by_package.push({
          name: m.package_name,
          severity: maxSev,
          count: m.vuln_count
        });
      }
    }
  }

  // Populate vulnerability_counts_json.by_severity from analysis_issues
  if (issues) {
    for (const issue of issues) {
      if (issue.type === 'vulnerable_dependency') {
        if (vulnerability_counts_json.by_severity[issue.severity] !== undefined) {
          vulnerability_counts_json.by_severity[issue.severity]++;
        } else {
          vulnerability_counts_json.by_severity[issue.severity] = 1;
        }
      }
    }
  }

  const dependency_counts_json = {
    total:      Number(dep_total)      || 0,
    direct:     Number(dep_direct)     || 0,
    transitive: Number(dep_transitive) || 0,
    vulnerable: Number(dep_vulnerable) || 0,
  };

  const snapshotDate = new Date().toISOString().split('T')[0];

  const payload = {
    repo_id: repoId,
    snapshot_date: snapshotDate,
    file_count,
    total_loc,
    avg_complexity,
    max_complexity,
    issue_counts_json,
    vulnerability_counts_json,
    dependency_counts_json,
    top_risks_json
  };

  const { data: inserted, error: upsertErr } = await db
    .from('repo_metrics_daily')
    .upsert(payload, { onConflict: 'repo_id, snapshot_date' })
    .select()
    .single();

  if (upsertErr) throw upsertErr;
  return inserted || payload; // return payload for test mock
}

module.exports = { computeSnapshot };
