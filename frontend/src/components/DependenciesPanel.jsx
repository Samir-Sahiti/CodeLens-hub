import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ECOSYSTEM_ICONS = {
  npm:       '📦',
  PyPI:      '🐍',
  Go:        '🐹',
  'crates.io': '🦀',
  RubyGems:  '💎',
  NuGet:     '🔷',
  unknown:   '📄',
};

const ECOSYSTEM_COLORS = {
  npm:         'text-yellow-400',
  PyPI:        'text-blue-400',
  Go:          'text-cyan-400',
  'crates.io': 'text-orange-400',
  RubyGems:   'text-red-400',
  NuGet:       'text-indigo-400',
  unknown:     'text-gray-400',
};

function severityBadge(severity) {
  switch (severity) {
    case 'high':   return 'bg-red-500/20 text-red-400 ring-1 ring-inset ring-red-500/30';
    case 'medium': return 'bg-orange-500/20 text-orange-400 ring-1 ring-inset ring-orange-500/30';
    case 'low':    return 'bg-yellow-500/20 text-yellow-400 ring-1 ring-inset ring-yellow-500/30';
    case 'clean':  return 'bg-green-500/20 text-green-400 ring-1 ring-inset ring-green-500/30';
    default:       return 'bg-gray-500/20 text-gray-400 ring-1 ring-inset ring-gray-500/30';
  }
}

function getManifestEcosystem(manifestPath) {
  const base = (manifestPath || '').split('/').pop().toLowerCase();
  if (base === 'package.json' || base === 'package-lock.json' || base === 'yarn.lock') return 'npm';
  if (base === 'requirements.txt' || base === 'pipfile.lock') return 'PyPI';
  if (base === 'go.mod') return 'Go';
  if (base === 'cargo.lock') return 'crates.io';
  if (base === 'gemfile.lock') return 'RubyGems';
  if (base.endsWith('.csproj')) return 'NuGet';
  return 'unknown';
}

function isLockfile(manifestPath) {
  const base = (manifestPath || '').split('/').pop().toLowerCase();
  return ['package-lock.json', 'yarn.lock', 'pipfile.lock', 'cargo.lock', 'gemfile.lock'].includes(base);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryBar({ totalVulns, vulnIssues }) {
  const high   = vulnIssues.filter(i => i.severity === 'high').length;
  const medium = vulnIssues.filter(i => i.severity === 'medium').length;
  const low    = vulnIssues.filter(i => i.severity === 'low').length;

  if (totalVulns === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-green-500/30 bg-green-500/10 px-5 py-4">
        <span className="text-2xl">✅</span>
        <div>
          <p className="text-sm font-semibold text-green-300">No known vulnerabilities found</p>
          <p className="text-xs text-green-400/70 mt-0.5">All scanned dependencies are clean according to the OSV database.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 rounded-xl border border-red-500/30 bg-red-500/5 px-5 py-4">
      <span className="text-2xl">⚠️</span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-white">
          {totalVulns} vulnerabilit{totalVulns === 1 ? 'y' : 'ies'} detected across your dependencies
        </p>
        <div className="flex items-center gap-3 mt-1.5">
          {high   > 0 && <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${severityBadge('high')}`}>{high} High</span>}
          {medium > 0 && <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${severityBadge('medium')}`}>{medium} Medium</span>}
          {low    > 0 && <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${severityBadge('low')}`}>{low} Low</span>}
        </div>
      </div>
      <a
        href="https://osv.dev"
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-xs text-gray-500 hover:text-gray-300 transition-colors"
      >
        Powered by OSV.dev ↗
      </a>
    </div>
  );
}

function VulnCard({ issue }) {
  const [expanded, setExpanded] = useState(false);

  // Parse structured info from description
  // Format: "CVE-xxx — ecosystem package "name@ver" has a known vulnerability. Fixed in name@ver. Advisory: https://... (CVSS: N.N)"
  const descParts = issue.description || '';
  const cveMatch   = descParts.match(/^([^\s—]+)/);
  const cveId      = cveMatch ? cveMatch[1] : 'Advisory';
  const advisoryM  = descParts.match(/Advisory:\s*(https:\/\/\S+)/);
  const advisoryUrl = advisoryM ? advisoryM[1].replace(/\)$/, '') : null;
  const cvssM      = descParts.match(/CVSS:\s*([\d.]+)/);
  const cvss       = cvssM ? cvssM[1] : null;
  const fixedM     = descParts.match(/Fixed in ([^\s.]+)\./);
  const fixedVer   = fixedM ? fixedM[1] : null;
  const manifestPath = (issue.file_paths || [])[0] || '';

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 hover:bg-gray-800/60 transition-colors">
      <div
        className="flex items-start gap-4 p-4 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <span className={`mt-0.5 inline-flex items-center rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wider shrink-0 ${severityBadge(issue.severity)}`}>
          {issue.severity}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-white font-semibold">{cveId}</span>
            {cvss && (
              <span className="text-xs text-gray-500 font-mono">CVSS {cvss}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 font-mono mt-1 truncate">{manifestPath}</p>
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-3">
          <p className="text-sm text-gray-300 leading-relaxed">{descParts}</p>
          <div className="flex flex-wrap gap-2">
            {fixedVer && (
              <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs text-green-300">
                ✓ Fix available: upgrade to <span className="font-mono font-semibold">{fixedVer}</span>
              </div>
            )}
            {!fixedVer && (
              <div className="rounded-md border border-gray-700 bg-gray-800/50 px-3 py-1.5 text-xs text-gray-400">
                No fix available yet
              </div>
            )}
            {advisoryUrl && (
              <a
                href={advisoryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/20 transition-colors"
                onClick={e => e.stopPropagation()}
              >
                View OSV Advisory ↗
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ManifestSection({ manifest, issuesForManifest }) {
  const ecosystem = manifest.ecosystem || getManifestEcosystem(manifest.path);
  const icon      = ECOSYSTEM_ICONS[ecosystem] || '📄';
  const colorCls  = ECOSYSTEM_COLORS[ecosystem] || 'text-gray-400';
  const lockfile  = isLockfile(manifest.path);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 bg-gray-900/60">
        <div className="flex items-center gap-3">
          <span className="text-xl">{icon}</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold font-mono ${colorCls}`}>
                {manifest.path}
              </span>
              {lockfile && (
                <span className="rounded-full bg-gray-700/60 px-2 py-0.5 text-xs text-gray-400">lockfile</span>
              )}
            </div>
            <span className="text-xs text-gray-500 mt-0.5 block">{ecosystem} ecosystem</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {manifest.vulnCount > 0 ? (
            <>
              {manifest.highCount   > 0 && <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${severityBadge('high')}`}>{manifest.highCount}H</span>}
              {manifest.mediumCount > 0 && <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${severityBadge('medium')}`}>{manifest.mediumCount}M</span>}
              {manifest.lowCount    > 0 && <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${severityBadge('low')}`}>{manifest.lowCount}L</span>}
            </>
          ) : (
            <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${severityBadge('clean')}`}>✓ Clean</span>
          )}
        </div>
      </div>

      {/* Vuln list */}
      {issuesForManifest.length > 0 ? (
        <div className="p-4 space-y-3">
          {issuesForManifest.map((issue, idx) => (
            <VulnCard key={issue.id || idx} issue={issue} />
          ))}
        </div>
      ) : (
        <div className="px-5 py-6 text-center text-sm text-gray-500">
          No vulnerabilities detected in this manifest.
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DependenciesPanel({ repoId }) {
  const { session } = useAuth();
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [data, setData]           = useState(null);
  const [searchQuery, setSearch]  = useState('');
  const [filter, setFilter]       = useState('all'); // all | vulnerable | clean

  useEffect(() => {
    if (!session?.access_token || !repoId) return;

    setLoading(true);
    setError(null);

    fetch(`/api/repos/${repoId}/dependencies`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [repoId, session?.access_token]);

  const manifests    = data?.manifests    || [];
  const vulnIssues   = data?.vulnIssues   || [];
  const totalVulns   = data?.totalVulns   || 0;

  // Group vuln issues by manifest path
  const issuesByManifest = useMemo(() => {
    const map = new Map();
    for (const issue of vulnIssues) {
      const p = (issue.file_paths || [])[0] || 'unknown';
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(issue);
    }
    return map;
  }, [vulnIssues]);

  // All manifest paths (from manifests + any in issues not in manifests list)
  const allManifestPaths = useMemo(() => {
    const set = new Set(manifests.map(m => m.path));
    for (const issue of vulnIssues) {
      const p = (issue.file_paths || [])[0];
      if (p) set.add(p);
    }
    return Array.from(set).sort();
  }, [manifests, vulnIssues]);

  const filteredManifests = useMemo(() => {
    return allManifestPaths.filter(p => {
      const matchesSearch = !searchQuery || p.toLowerCase().includes(searchQuery.toLowerCase());
      const issues = issuesByManifest.get(p) || [];
      const matchesFilter =
        filter === 'all' ||
        (filter === 'vulnerable' && issues.length > 0) ||
        (filter === 'clean'      && issues.length === 0);
      return matchesSearch && matchesFilter;
    });
  }, [allManifestPaths, issuesByManifest, searchQuery, filter]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-[40rem] flex-col gap-4 rounded-xl border border-gray-800 bg-gray-900/30 p-6">
        {/* Summary skeleton */}
        <div className="h-16 rounded-xl bg-gray-800/50 animate-pulse" />
        <div className="h-8  rounded-lg bg-gray-800/40 animate-pulse w-1/3" />
        {[1,2,3].map(i => (
          <div key={i} className="h-20 rounded-xl bg-gray-800/30 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[40rem] flex-col items-center justify-center rounded-xl border border-dashed border-red-800 bg-red-950/10">
        <p className="text-red-400 text-sm">Failed to load dependency data: {error}</p>
      </div>
    );
  }

  if (allManifestPaths.length === 0) {
    return (
      <div className="flex h-[40rem] flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/30 gap-4">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-gray-800/60">
          <span className="text-3xl">📦</span>
        </div>
        <div className="text-center">
          <h3 className="text-base font-semibold text-gray-200 mb-1">No manifest files detected</h3>
          <p className="text-sm text-gray-500 max-w-sm">
            No <code className="bg-gray-800 rounded px-1 text-xs">package.json</code>,{' '}
            <code className="bg-gray-800 rounded px-1 text-xs">requirements.txt</code>, or other
            dependency manifests were found in this repository.
          </p>
        </div>
        <a
          href="https://osv.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          Powered by OSV.dev ↗
        </a>
      </div>
    );
  }

  const vulnManifestCount  = allManifestPaths.filter(p => (issuesByManifest.get(p) || []).length > 0).length;
  const cleanManifestCount = allManifestPaths.length - vulnManifestCount;

  return (
    <div className="flex flex-col gap-6 h-[40rem] overflow-y-auto pb-4 pr-1">
      {/* Summary banner */}
      <SummaryBar totalVulns={totalVulns} vulnIssues={vulnIssues} />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 text-center">
          <p className="text-2xl font-bold text-white">{allManifestPaths.length}</p>
          <p className="text-xs text-gray-500 mt-1">Manifests scanned</p>
        </div>
        <div className="rounded-xl border border-red-800/40 bg-red-950/20 p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{totalVulns}</p>
          <p className="text-xs text-gray-500 mt-1">Vulnerabilities</p>
        </div>
        <div className="rounded-xl border border-green-800/40 bg-green-950/20 p-4 text-center">
          <p className="text-2xl font-bold text-green-400">{cleanManifestCount}</p>
          <p className="text-xs text-gray-500 mt-1">Clean manifests</p>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg border border-gray-700 overflow-hidden">
          {[
            { key: 'all',        label: 'All' },
            { key: 'vulnerable', label: `Vulnerable (${vulnManifestCount})` },
            { key: 'clean',      label: `Clean (${cleanManifestCount})` },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === opt.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter by path..."
          value={searchQuery}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-0 max-w-xs rounded-lg border border-gray-700 bg-gray-900 text-sm text-white px-3 py-1.5 focus:outline-none focus:border-indigo-500 placeholder:text-gray-600 transition-colors"
        />
        <span className="text-xs text-gray-500 ml-auto">
          {filteredManifests.length} of {allManifestPaths.length} manifests
        </span>
      </div>

      {/* Manifest sections */}
      {filteredManifests.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-sm text-gray-500">
          No manifests match the current filter.
        </div>
      ) : (
        <div className="space-y-4">
          {/* Vulnerable first */}
          {filteredManifests
            .sort((a, b) => {
              const av = (issuesByManifest.get(a) || []).length;
              const bv = (issuesByManifest.get(b) || []).length;
              return bv - av; // most vulns first
            })
            .map(manifestPath => {
              const manifestEntry = manifests.find(m => m.path === manifestPath) || {
                path:        manifestPath,
                ecosystem:   getManifestEcosystem(manifestPath),
                vulnCount:   (issuesByManifest.get(manifestPath) || []).length,
                highCount:   (issuesByManifest.get(manifestPath) || []).filter(i => i.severity === 'high').length,
                mediumCount: (issuesByManifest.get(manifestPath) || []).filter(i => i.severity === 'medium').length,
                lowCount:    (issuesByManifest.get(manifestPath) || []).filter(i => i.severity === 'low').length,
              };
              return (
                <ManifestSection
                  key={manifestPath}
                  manifest={manifestEntry}
                  issuesForManifest={issuesByManifest.get(manifestPath) || []}
                />
              );
            })
          }
        </div>
      )}

      {/* Requirements.txt notice */}
      {allManifestPaths.some(p => p.split('/').pop().toLowerCase() === 'requirements.txt') && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-300/80">
          ⚠️ <strong>requirements.txt</strong> without a corresponding lockfile: only pinned (
          <code>==</code>) dependencies can be checked. Use <code>pip freeze &gt; requirements.txt</code> or
          add a <code>Pipfile.lock</code> for full transitive coverage.
        </div>
      )}

      <p className="text-xs text-gray-600 text-center pb-2">
        Vulnerability data sourced from{' '}
        <a href="https://osv.dev" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-gray-300 transition-colors">
          OSV.dev
        </a>{' '}
        · cached for 24 hours
      </p>
    </div>
  );
}
