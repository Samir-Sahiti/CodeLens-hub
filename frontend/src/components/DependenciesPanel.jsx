<<<<<<< HEAD
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
=======
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function EcosystemBadge({ ecosystem }) {
  const colors = {
    npm:       'bg-red-500/15 text-red-400 ring-red-500/20',
    PyPI:      'bg-blue-500/15 text-blue-400 ring-blue-500/20',
    Go:        'bg-cyan-500/15 text-cyan-400 ring-cyan-500/20',
    'crates.io': 'bg-orange-500/15 text-orange-400 ring-orange-500/20',
    RubyGems:  'bg-red-700/15 text-red-300 ring-red-700/20',
    NuGet:     'bg-purple-500/15 text-purple-400 ring-purple-500/20',
  };
  const cls = colors[ecosystem] || 'bg-gray-500/15 text-gray-400 ring-gray-500/20';
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {ecosystem}
    </span>
  );
}

function SeverityBadge({ severity }) {
  const styles = {
    high:   'bg-red-500/20 text-red-400 ring-1 ring-inset ring-red-500/30',
    medium: 'bg-orange-500/20 text-orange-400 ring-1 ring-inset ring-orange-500/30',
    low:    'bg-yellow-500/20 text-yellow-400 ring-1 ring-inset ring-yellow-500/30',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium uppercase tracking-wider ${styles[severity] || styles.low}`}>
      {severity}
    </span>
  );
}

function SortIcon({ columnKey, sortConfig }) {
  if (sortConfig.key !== columnKey) return <span className="ml-1 text-gray-600 font-mono text-xs">↕</span>;
  return <span className="ml-1 text-indigo-400 font-mono text-xs">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DependenciesPanel({ repoId, refreshKey = 0 }) {
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [deps, setDeps]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterEcosystem, setFilterEcosystem] = useState('all');
  const [showOnlyVulnerable, setShowOnlyVulnerable] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'vuln_count', direction: 'desc' });
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    setLoading(true);

    const fetchDeps = async () => {
      try {
        const res = await fetch(apiUrl(`/api/repos/${repoId}/dependencies`), {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setDeps(data.dependencies || []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDeps();
    return () => { cancelled = true; };
  }, [repoId, session?.access_token, refreshKey]);

  const ecosystems = useMemo(() => ['all', ...new Set(deps.map(d => d.ecosystem))], [deps]);
  const highlightedPackage = searchParams.get('dep') || '';
  const highlightedFromIssue = searchParams.get('vulnerable') === '1';
  const fallbackIssue = useMemo(() => {
    if (!highlightedFromIssue) return null;

    const description = searchParams.get('dep_description') || '';
    const manifestPath = searchParams.get('dep_manifest') || '';
    const severity = searchParams.get('dep_severity') || 'medium';

    if (!description && !highlightedPackage) return null;

    return {
      packageName: highlightedPackage || 'Dependency',
      manifestPath,
      severity,
      description,
    };
  }, [highlightedFromIssue, highlightedPackage, searchParams]);

  useEffect(() => {
    if (highlightedPackage) {
      setSearchQuery(highlightedPackage);
    }
    if (highlightedFromIssue) {
      setShowOnlyVulnerable(true);
    }
  }, [highlightedFromIssue, highlightedPackage]);

  const hasRequirementsTxt = useMemo(
    () => deps.some(d => d.manifest_path?.toLowerCase().endsWith('requirements.txt')),
    [deps]
  );

  const totalVulnerable = useMemo(() => deps.filter(d => d.vuln_count > 0).length, [deps]);
  const totalClean      = useMemo(() => deps.filter(d => d.vuln_count === 0).length, [deps]);

  const filteredDeps = useMemo(() => {
    let result = [...deps];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(d => d.package_name.toLowerCase().includes(q) || d.manifest_path.toLowerCase().includes(q));
    }
    if (filterEcosystem !== 'all') {
      result = result.filter(d => d.ecosystem === filterEcosystem);
    }
    if (showOnlyVulnerable) {
      result = result.filter(d => d.vuln_count > 0);
    }
    result.sort((a, b) => {
      let valA = a[sortConfig.key];
      let valB = b[sortConfig.key];
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  }, [deps, searchQuery, filterEcosystem, showOnlyVulnerable, sortConfig]);

  const handleSort = useCallback((key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  }, []);

  const toggleExpand = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const clearIssueFocus = useCallback(() => {
    setSearchQuery('');
    setShowOnlyVulnerable(false);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('dep');
      next.delete('vulnerable');
      next.delete('dep_description');
      next.delete('dep_manifest');
      next.delete('dep_severity');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // ── Loading state ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-[40rem] flex-col items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
        <p className="mt-3 text-sm text-gray-400">Loading dependencies…</p>
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
      </div>
    );
  }

<<<<<<< HEAD
  if (error) {
    return (
      <div className="flex h-[40rem] flex-col items-center justify-center rounded-xl border border-dashed border-red-800 bg-red-950/10">
        <p className="text-red-400 text-sm">Failed to load dependency data: {error}</p>
=======
  // ── Error state ─────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="rounded-md bg-red-900/50 p-4 border border-red-800 text-red-200 text-sm">
        Failed to load dependency data: {error}
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
      </div>
    );
  }

<<<<<<< HEAD
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
=======
  // ── Empty state ─────────────────────────────────────────────────────────────

  if (deps.length === 0) {
    if (fallbackIssue) {
      return (
        <div className="flex flex-col gap-5 h-[40rem]">
          <div className="shrink-0 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
            Dependency inventory data is unavailable for this repository, but the issue you clicked is preserved below so you can still inspect it.
          </div>
          <DependencyIssueFallback issue={fallbackIssue} onClearFocus={clearIssueFocus} />
        </div>
      );
    }

    return (
      <div className="flex h-[40rem] flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/30">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-indigo-500/10 mb-4">
          <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-200 mb-1">No dependencies detected</h3>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          No recognised dependency manifest files were found in this repository, or the repository has not been indexed yet.
        </p>
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
      </div>
    );
  }

<<<<<<< HEAD
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
=======
  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5 h-[40rem]">

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 shrink-0">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Total Packages</p>
          <p className="text-2xl font-bold text-white">{deps.length}</p>
        </div>
        <div className="rounded-xl border border-red-900/40 bg-red-900/10 p-4">
          <p className="text-xs uppercase tracking-widest text-red-400/80 mb-1">Vulnerable</p>
          <p className="text-2xl font-bold text-red-400">{totalVulnerable}</p>
        </div>
        <div className="rounded-xl border border-green-900/40 bg-green-900/10 p-4">
          <p className="text-xs uppercase tracking-widest text-green-400/80 mb-1">Clean</p>
          <p className="text-2xl font-bold text-green-400">{totalClean}</p>
        </div>
      </div>

      <div className="shrink-0 rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 text-sm text-gray-400">
        Dependencies is the full package inventory for this repository. Vulnerable packages are also listed in `Issues` so risk triage stays in one place.
      </div>

      {(highlightedPackage || highlightedFromIssue) && (
        <div className="shrink-0 flex items-center justify-between gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-3">
          <p className="text-sm text-indigo-200">
            Showing dependency details from an issue{highlightedPackage ? ` for ` : ''}{highlightedPackage && (
              <span className="font-mono text-indigo-100">{highlightedPackage}</span>
            )}.
          </p>
          <button
            type="button"
            onClick={clearIssueFocus}
            className="rounded-md border border-indigo-400/30 px-3 py-1.5 text-xs font-medium text-indigo-100 transition hover:bg-indigo-400/10"
          >
            Clear focus
          </button>
        </div>
      )}

      {/* requirements.txt limitation banner */}
      {hasRequirementsTxt && (
        <div className="shrink-0 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <svg className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-xs text-amber-300">
            <strong>requirements.txt detected</strong> — only <em>direct</em> dependencies are checked. Transitive vulnerabilities require a lockfile (e.g. generated by <code className="rounded bg-amber-900/40 px-1">pip freeze &gt; requirements.txt</code> or <code className="rounded bg-amber-900/40 px-1">Pipfile.lock</code>).
          </p>
        </div>
      )}

      {/* Filter bar */}
      <div className="shrink-0 flex items-center gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            id="dep-search"
            type="text"
            placeholder="Search packages or manifests..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-gray-950 border border-gray-700 text-sm text-white rounded-md pl-9 pr-3 py-2 focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-gray-600"
          />
        </div>
        <select
          id="dep-ecosystem-filter"
          value={filterEcosystem}
          onChange={e => setFilterEcosystem(e.target.value)}
          className="bg-gray-950 border border-gray-700 text-sm text-white rounded-md px-3 py-2 focus:outline-none focus:border-indigo-500 transition-colors"
        >
          {ecosystems.map(eco => (
            <option key={eco} value={eco}>{eco === 'all' ? 'All ecosystems' : eco}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowOnlyVulnerable(prev => !prev)}
          className={`rounded-md border px-3 py-2 text-sm transition-colors ${
            showOnlyVulnerable
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : 'border-gray-700 bg-gray-950 text-gray-300 hover:border-gray-600'
          }`}
        >
          {showOnlyVulnerable ? 'Showing Vulnerable Only' : 'Vulnerable Only'}
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-gray-800 bg-gray-900/30 min-h-0">
        <table className="w-full text-sm text-left whitespace-nowrap">
          <thead className="bg-gray-800/95 text-gray-300 sticky top-0 z-10">
            <tr>
              <th
                id="dep-col-package"
                className="px-5 py-3 font-semibold cursor-pointer hover:text-white transition-colors select-none"
                onClick={() => handleSort('package_name')}
              >
                Package <SortIcon columnKey="package_name" sortConfig={sortConfig} />
              </th>
              <th
                id="dep-col-version"
                className="px-5 py-3 font-semibold cursor-pointer hover:text-white transition-colors select-none"
                onClick={() => handleSort('version')}
              >
                Version <SortIcon columnKey="version" sortConfig={sortConfig} />
              </th>
              <th
                id="dep-col-ecosystem"
                className="px-5 py-3 font-semibold cursor-pointer hover:text-white transition-colors select-none"
                onClick={() => handleSort('ecosystem')}
              >
                Ecosystem <SortIcon columnKey="ecosystem" sortConfig={sortConfig} />
              </th>
              <th className="px-5 py-3 font-semibold text-gray-400">Manifest</th>
              <th
                id="dep-col-status"
                className="px-5 py-3 font-semibold cursor-pointer hover:text-white transition-colors select-none"
                onClick={() => handleSort('vuln_count')}
              >
                Status <SortIcon columnKey="vuln_count" sortConfig={sortConfig} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {filteredDeps.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-500">
                  No packages match your search.
                </td>
              </tr>
            ) : (
              filteredDeps.map((dep) => {
                const rowId   = dep.id || `${dep.ecosystem}-${dep.package_name}-${dep.version}`;
                const isExpanded = expandedId === rowId;
                const vulns   = dep.vulns_json || [];
                const hasVulns = dep.vuln_count > 0;

                return (
                  <Dependency
                    key={rowId}
                    id={rowId}
                    dep={dep}
                    vulns={vulns}
                    hasVulns={hasVulns}
                    isExpanded={isExpanded}
                    onToggle={() => toggleExpand(rowId)}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="shrink-0 text-xs text-gray-600 text-right">
        Vulnerability data provided by <a href="https://osv.dev" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">OSV.dev</a>. Cache refreshes every 24 hours.
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
      </p>
    </div>
  );
}
<<<<<<< HEAD
=======

// ── Row sub-component ─────────────────────────────────────────────────────────

function DependencyIssueFallback({ issue, onClearFocus, compact = false }) {
  const advisoryUrlMatch = issue.description?.match(/Advisory:\s(https?:\/\/\S+)/);
  const advisoryUrl = advisoryUrlMatch?.[1] || '';
  const descriptionWithoutAdvisory = advisoryUrl
    ? issue.description.replace(/\s*Advisory:\shttps?:\/\/\S+/, '')
    : issue.description;

  return (
    <div className={`shrink-0 rounded-xl border border-gray-800 bg-gray-900/50 ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">Dependency Issue</p>
          <div className="flex items-center gap-2 mb-3">
            <span className="font-mono text-sm text-white">{issue.packageName}</span>
            <SeverityBadge severity={issue.severity} />
          </div>
        </div>
        <button
          type="button"
          onClick={onClearFocus}
          className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-gray-800"
        >
          Clear focus
        </button>
      </div>

      {issue.manifestPath && (
        <p className="mb-3 text-xs text-gray-500">
          Manifest: <span className="font-mono text-gray-400">{issue.manifestPath}</span>
        </p>
      )}

      {descriptionWithoutAdvisory ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-gray-300">{descriptionWithoutAdvisory}</p>
          {advisoryUrl && (
            <a
              href={advisoryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sm text-indigo-400 hover:text-indigo-300 hover:underline"
            >
              View advisory
            </a>
          )}
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-gray-400">
          This dependency issue was opened from the Issues tab, but no additional inventory details are currently available.
        </p>
      )}
    </div>
  );
}

function Dependency({ id, dep, vulns, hasVulns, isExpanded, onToggle }) {
  return (
    <>
      <tr
        id={`dep-row-${id}`}
        onClick={hasVulns ? onToggle : undefined}
        className={`transition-colors ${
          hasVulns
            ? 'cursor-pointer hover:bg-gray-800/50'
            : 'opacity-80 hover:bg-gray-800/20'
        } ${isExpanded ? 'bg-gray-800/40' : ''}`}
      >
        {/* Package name */}
        <td className="px-5 py-3">
          <div className="flex items-center gap-2">
            {hasVulns && (
              <svg
                className={`h-3.5 w-3.5 text-gray-500 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
            <span className={`font-mono text-xs ${hasVulns ? 'text-white font-semibold' : 'text-gray-300'}`}>
              {dep.package_name}
            </span>
            {dep.is_transitive && (
              <span className="text-gray-600 text-xs">(transitive)</span>
            )}
          </div>
        </td>

        {/* Version */}
        <td className="px-5 py-3">
          <span className="font-mono text-xs text-gray-400">{dep.version || '—'}</span>
        </td>

        {/* Ecosystem */}
        <td className="px-5 py-3">
          <EcosystemBadge ecosystem={dep.ecosystem} />
        </td>

        {/* Manifest path */}
        <td className="px-5 py-3 max-w-[200px]">
          <span className="font-mono text-xs text-gray-500 truncate block" title={dep.manifest_path}>
            {dep.manifest_path}
          </span>
        </td>

        {/* Status */}
        <td className="px-5 py-3">
          {hasVulns ? (
            <span className="inline-flex items-center gap-1.5 text-red-400 text-xs font-semibold">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              {dep.vuln_count} issue{dep.vuln_count !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-green-500 text-xs font-medium">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Clean
            </span>
          )}
        </td>
      </tr>

      {/* Expanded vulnerability details */}
      {isExpanded && hasVulns && (
        <tr id={`dep-detail-${id}`} className="bg-gray-950/60">
          <td colSpan={5} className="px-5 pb-4 pt-2">
            <div className="ml-5 space-y-3">
              {vulns.map((vuln, idx) => (
                <div
                  key={vuln.id || idx}
                  className="rounded-lg border border-gray-800 bg-gray-900/60 p-4"
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={vuln.severity} />
                      <span className="font-mono text-xs text-gray-200 font-semibold">
                        {(vuln.aliases && vuln.aliases.length > 0) ? vuln.aliases[0] : vuln.id}
                      </span>
                      {vuln.aliases && vuln.aliases.length > 0 && (
                        <span className="text-xs text-gray-500">({vuln.id})</span>
                      )}
                    </div>
                    <a
                      href={vuln.advisoryUrl || `https://osv.dev/vulnerability/${vuln.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-xs text-indigo-400 hover:text-indigo-300 hover:underline transition-colors shrink-0"
                    >
                      View advisory ↗
                    </a>
                  </div>

                  {vuln.summary && (
                    <p className="text-xs text-gray-400 leading-relaxed mb-2">{vuln.summary}</p>
                  )}

                  {vuln.fixedVersion && (
                    <div className="flex items-center gap-2 text-xs text-green-400">
                      <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Upgrade to <strong className="ml-1 font-mono">{vuln.fixedVersion}</strong>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
