import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { ArrowDown, ArrowUp, AlertTriangle, CheckCircle2, ExternalLink, Package } from './ui/Icons';
import { Button, SearchInput, Select } from './ui/Primitives';

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
  if (sortConfig.key !== columnKey) return <span className="ml-1 inline-block h-3 w-3 rounded-full border border-gray-700/80 align-middle" />;
  const Icon = sortConfig.direction === 'asc' ? ArrowUp : ArrowDown;
  return <Icon className="ml-1 inline h-3.5 w-3.5 align-middle text-indigo-300" />;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DependenciesPanel({ repoId, refreshKey = 0 }) {
  const { session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [deps, setDeps]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [statusInfo, setStatusInfo] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterEcosystem, setFilterEcosystem] = useState('all');
  const [showOnlyVulnerable, setShowOnlyVulnerable] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'vuln_count', direction: 'desc' });
  const [expandedId, setExpandedId] = useState(null);

  const fetchDependencies = useCallback(async (cancelledRef) => {
    const res = await fetch(apiUrl(`/api/repos/${repoId}/dependencies`), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!cancelledRef.current) {
      setDeps(data.dependencies || []);
      setError(null);
    }
  }, [repoId, session?.access_token]);

  const fetchStatus = useCallback(async (cancelledRef) => {
    const res = await fetch(apiUrl(`/api/repos/${repoId}/status`), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!cancelledRef.current) {
      setStatusInfo(data);
    }
    return data;
  }, [repoId, session?.access_token]);

  useEffect(() => {
    if (!session?.access_token) return;
    const cancelledRef = { current: false };
    let pollId = null;
    setLoading(true);

    const load = async () => {
      try {
        const currentStatus = await fetchStatus(cancelledRef);
        await fetchDependencies(cancelledRef);

        const shouldPoll =
          currentStatus?.latest_job?.enrichment_status === 'running' ||
          currentStatus?.latest_job?.current_stage === 'sca' ||
          currentStatus?.status === 'pending' ||
          currentStatus?.status === 'indexing';

        if (!cancelledRef.current && shouldPoll) {
          pollId = setInterval(async () => {
            try {
              const polledStatus = await fetchStatus(cancelledRef);
              await fetchDependencies(cancelledRef);
              const stillPolling =
                polledStatus?.latest_job?.enrichment_status === 'running' ||
                polledStatus?.latest_job?.current_stage === 'sca' ||
                polledStatus?.status === 'pending' ||
                polledStatus?.status === 'indexing';
              if (!stillPolling && pollId) {
                clearInterval(pollId);
                pollId = null;
              }
            } catch (pollErr) {
              if (!cancelledRef.current) setError(pollErr.message);
            }
          }, 1000);
        }
      } catch (err) {
        if (!cancelledRef.current) setError(err.message);
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    };

    load();
    return () => {
      cancelledRef.current = true;
      if (pollId) clearInterval(pollId);
    };
  }, [fetchDependencies, fetchStatus, refreshKey, repoId, session?.access_token]);

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
  const inventoryStillBuilding = statusInfo?.latest_job?.enrichment_status === 'running' || statusInfo?.latest_job?.current_stage === 'sca';

  const SEVERITY_RANK = { high: 3, medium: 2, low: 1, none: 0 };
  const getMaxSeverity = (dep) => {
    const vulns = dep.vulns_json || [];
    if (!vulns.length) return 0;
    return Math.max(...vulns.map(v => SEVERITY_RANK[v.severity] || 0));
  };

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
      let valA, valB;
      if (sortConfig.key === 'max_severity') {
        valA = getMaxSeverity(a);
        valB = getMaxSeverity(b);
      } else {
        valA = a[sortConfig.key];
        valB = b[sortConfig.key];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
      }
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="flex h-auto min-h-[30rem] flex-col items-center justify-center xl:h-[calc(100vh-12rem)]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
        <p className="mt-3 text-sm text-gray-400">Loading dependencies…</p>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="rounded-md bg-red-900/50 p-4 border border-red-800 text-red-200 text-sm">
        Failed to load dependency data: {error}
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (deps.length === 0) {
    if (inventoryStillBuilding) {
      return (
        <div className="flex h-auto min-h-[30rem] flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/30 px-6 text-center xl:h-[calc(100vh-12rem)]">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mb-4" />
          <h3 className="text-lg font-medium text-gray-200 mb-1">Building dependency inventory</h3>
          <p className="text-sm text-gray-500 text-center max-w-sm">
            Core analysis is ready, but dependency inventory is still being enriched. This view refreshes automatically until all packages are available.
          </p>
        </div>
      );
    }

    if (fallbackIssue) {
      return (
        <div className="flex h-auto min-h-[30rem] flex-col gap-5 xl:h-[calc(100vh-12rem)]">
          <div className="shrink-0 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
            Dependency inventory data is unavailable for this repository, but the issue you clicked is preserved below so you can still inspect it.
          </div>
          <DependencyIssueFallback issue={fallbackIssue} onClearFocus={clearIssueFocus} />
        </div>
      );
    }

    return (
      <div className="flex h-auto min-h-[30rem] flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/30 px-6 text-center xl:h-[calc(100vh-12rem)]">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-indigo-500/10 mb-4">
          <Package className="h-8 w-8 text-indigo-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-200 mb-1">No dependencies found</h3>
        <p className="text-sm text-gray-500 text-center max-w-sm">
          No recognised dependency manifest files were found in this repository.
        </p>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-auto min-h-[30rem] flex-col gap-5 xl:h-[calc(100vh-12rem)]">

      {/* Summary Cards */}
      <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4 border-l-4 border-l-indigo-500">
          <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Total Packages</p>
          <p className="text-2xl font-bold text-white">{deps.length}</p>
        </div>
        <div className="rounded-xl border border-red-900/40 bg-red-900/10 p-4 border-l-4 border-l-red-500">
          <p className="text-xs uppercase tracking-widest text-red-400/80 mb-1">Vulnerable</p>
          <p className="text-2xl font-bold text-red-400">{totalVulnerable}</p>
        </div>
        <div className="rounded-xl border border-green-900/40 bg-green-900/10 p-4 border-l-4 border-l-emerald-500">
          <p className="text-xs uppercase tracking-widest text-green-400/80 mb-1">Clean</p>
          <p className="text-2xl font-bold text-green-400">{totalClean}</p>
        </div>
      </div>

      <div className="shrink-0 rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 text-sm text-gray-400">
        Dependencies is the full package inventory for this repository. Vulnerable packages are also listed in `Issues` so risk triage stays in one place.
      </div>

      {(highlightedPackage || highlightedFromIssue) && (
        <div className="flex shrink-0 flex-col gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex shrink-0 items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-300">
            <strong>requirements.txt detected</strong> — only <em>direct</em> dependencies are checked. Transitive vulnerabilities require a lockfile (e.g. generated by <code className="rounded bg-amber-900/40 px-1">pip freeze &gt; requirements.txt</code> or <code className="rounded bg-amber-900/40 px-1">Pipfile.lock</code>).
          </p>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex shrink-0 flex-col gap-3 md:flex-row md:items-center">
        <SearchInput
          id="dep-search"
          type="text"
          placeholder="Search packages or manifests..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1"
        />
        <Select
          id="dep-ecosystem-filter"
          value={filterEcosystem}
          onChange={e => setFilterEcosystem(e.target.value)}
          className="w-full md:w-auto"
        >
          {ecosystems.map(eco => (
            <option key={eco} value={eco}>{eco === 'all' ? 'All ecosystems' : eco}</option>
          ))}
        </Select>
        <Button
          type="button"
          onClick={() => setShowOnlyVulnerable(prev => !prev)}
          variant={showOnlyVulnerable ? 'danger' : 'outline'}
          className="md:whitespace-nowrap"
        >
          {showOnlyVulnerable ? 'Showing Vulnerable Only' : 'Vulnerable Only'}
        </Button>
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
                id="dep-col-severity"
                className="px-5 py-3 font-semibold cursor-pointer hover:text-white transition-colors select-none"
                onClick={() => handleSort('max_severity')}
              >
                Severity <SortIcon columnKey="max_severity" sortConfig={sortConfig} />
              </th>
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
                <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-500">
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
      </p>
    </div>
  );
}

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
              <ArrowDown className={`h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : '-rotate-90'}`} />
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

        {/* Max severity */}
        <td className="px-5 py-3">
          {hasVulns ? (() => {
            const top = vulns.reduce((best, v) => {
              const rank = { high: 3, medium: 2, low: 1 };
              return (rank[v.severity] || 0) > (rank[best?.severity] || 0) ? v : best;
            }, vulns[0]);
            return <SeverityBadge severity={top?.severity} />;
          })() : <span className="text-gray-700 text-xs">—</span>}
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
          <td colSpan={6} className="px-5 pb-4 pt-2">
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
                      View advisory <ExternalLink className="ml-1 inline h-3 w-3" />
                    </a>
                  </div>

                  {vuln.summary && (
                    <p className="text-xs text-gray-400 leading-relaxed mb-2">{vuln.summary}</p>
                  )}

                  {vuln.fixedVersion && (
                    <div className="flex items-center gap-2 text-xs text-green-400">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
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
