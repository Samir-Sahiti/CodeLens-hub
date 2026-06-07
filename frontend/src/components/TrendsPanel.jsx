import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { TrendingUp, TrendingDown, Download } from './ui/Icons';

const RANGES = [
  { label: '7d',  value: '7d'  },
  { label: '30d', value: '30d' },
  { label: '90d', value: '90d' },
  { label: 'All', value: 'all' },
];

const SEVERITY_COLORS = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
};

function KpiCard({ label, value, delta, lowerIsBetter = true }) {
  const isNeutral = delta == null || delta === 0;
  const isWorse = lowerIsBetter ? delta > 0 : delta < 0;
  const color = isNeutral ? 'text-gray-400' : isWorse ? 'text-red-400' : 'text-green-400';
  const Icon = delta > 0 ? TrendingUp : TrendingDown;

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-white tabular-nums">
        {value != null ? value.toLocaleString() : '—'}
      </p>
      {!isNeutral && (
        <span className={`flex items-center gap-1 text-xs font-medium ${color}`}>
          <Icon className="h-3 w-3" />
          {delta > 0 ? '+' : ''}{typeof delta === 'number' && !Number.isInteger(delta) ? delta.toFixed(2) : delta} vs period start
        </span>
      )}
    </div>
  );
}

function NoDataBanner({ snapshotCount }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/30 px-6 py-4 text-sm text-gray-400">
      {snapshotCount < 7
        ? 'Trends fill in as your repo is re-indexed daily. Come back in a week for a full picture.'
        : 'No snapshot data available for this period.'}
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-4">
      <p className="mb-3 text-xs uppercase tracking-[0.2em] text-gray-500">{title}</p>
      {children}
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${m}/${d}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-medium text-gray-300">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-gray-400">{entry.name}:</span>
          <span className="font-semibold text-white">
            {typeof entry.value === 'number' && !Number.isInteger(entry.value)
              ? entry.value.toFixed(2)
              : entry.value?.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

function exportCsv(snapshots) {
  if (!snapshots?.length) return;
  const headers = [
    'date', 'file_count', 'total_loc', 'avg_complexity',
    'critical_issues', 'high_issues', 'medium_issues', 'low_issues',
    'vuln_critical', 'vuln_high', 'vuln_medium', 'vuln_low',
  ];
  const rows = snapshots.map(s => [
    s.snapshot_date,
    s.file_count,
    s.total_loc,
    s.avg_complexity != null ? s.avg_complexity.toFixed(2) : '',
    s.issue_counts_json?.by_severity?.critical ?? 0,
    s.issue_counts_json?.by_severity?.high ?? 0,
    s.issue_counts_json?.by_severity?.medium ?? 0,
    s.issue_counts_json?.by_severity?.low ?? 0,
    s.vulnerability_counts_json?.by_severity?.critical ?? 0,
    s.vulnerability_counts_json?.by_severity?.high ?? 0,
    s.vulnerability_counts_json?.by_severity?.medium ?? 0,
    s.vulnerability_counts_json?.by_severity?.low ?? 0,
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'codelens-trends.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function TrendsPanel({ repoId }) {
  const { session } = useAuth();
  const [range, setRange] = useState('30d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchTrends = useCallback(async () => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/trends?range=${range}`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to load trends');
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [repoId, range, session?.access_token]);

  useEffect(() => { fetchTrends(); }, [fetchTrends]);

  const snapshots = data?.snapshots ?? [];
  const summary = data?.summary ?? null;

  // Flatten snapshot data for Recharts
  const chartData = snapshots.map(s => ({
    date:     formatDate(s.snapshot_date),
    fullDate: s.snapshot_date,
    file_count:     s.file_count ?? 0,
    total_loc:      s.total_loc ?? 0,
    avg_complexity: s.avg_complexity != null ? parseFloat(s.avg_complexity.toFixed(2)) : 0,
    critical: s.issue_counts_json?.by_severity?.critical ?? 0,
    high:     s.issue_counts_json?.by_severity?.high ?? 0,
    medium:   s.issue_counts_json?.by_severity?.medium ?? 0,
    low:      s.issue_counts_json?.by_severity?.low ?? 0,
    vuln_critical: s.vulnerability_counts_json?.by_severity?.critical ?? 0,
    vuln_high:     s.vulnerability_counts_json?.by_severity?.high ?? 0,
    vuln_medium:   s.vulnerability_counts_json?.by_severity?.medium ?? 0,
    vuln_low:      s.vulnerability_counts_json?.by_severity?.low ?? 0,
  }));

  const cur  = summary?.current;
  const delta = summary?.delta;

  const totalVulnsCur   = cur ? ((cur.total_vulnerabilities) ?? 0) : null;
  const deltaVulns       = delta?.total_vulnerabilities ?? null;
  const deltaCritical    = delta?.critical_issues ?? null;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Trends</h2>
        <div className="flex items-center gap-2">
          {/* Range selector */}
          <div className="flex rounded-lg border border-gray-700 bg-gray-900 overflow-hidden">
            {RANGES.map(r => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  range === r.value
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {/* CSV export */}
          <button
            onClick={() => exportCsv(snapshots)}
            disabled={!snapshots.length}
            title="Export as CSV"
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:border-gray-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-gray-800 bg-gray-900/60" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {!loading && !error && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiCard
              label="Critical Issues"
              value={cur?.critical_issues ?? null}
              delta={deltaCritical}
              lowerIsBetter
            />
            <KpiCard
              label="Vulnerabilities"
              value={totalVulnsCur}
              delta={deltaVulns}
              lowerIsBetter
            />
            <KpiCard
              label="Avg Complexity"
              value={cur?.avg_complexity != null ? parseFloat(cur.avg_complexity.toFixed(2)) : null}
              delta={delta?.avg_complexity ?? null}
              lowerIsBetter
            />
            <KpiCard
              label="File Count"
              value={cur?.file_count ?? null}
              delta={delta?.file_count ?? null}
              lowerIsBetter={false}
            />
          </div>

          {/* "Too little data" helper */}
          {snapshots.length < 7 && <NoDataBanner snapshotCount={snapshots.length} />}

          {snapshots.length === 0 ? null : (
            <div className="space-y-4">
              {/* Issues by severity */}
              <ChartCard title="Total Issues by Severity">
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} width={32} />
                    <RechartsTooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                    <Area type="monotone" dataKey="critical" name="Critical" stackId="1" stroke={SEVERITY_COLORS.critical} fill={SEVERITY_COLORS.critical} fillOpacity={0.3} />
                    <Area type="monotone" dataKey="high"     name="High"     stackId="1" stroke={SEVERITY_COLORS.high}     fill={SEVERITY_COLORS.high}     fillOpacity={0.3} />
                    <Area type="monotone" dataKey="medium"   name="Medium"   stackId="1" stroke={SEVERITY_COLORS.medium}   fill={SEVERITY_COLORS.medium}   fillOpacity={0.3} />
                    <Area type="monotone" dataKey="low"      name="Low"      stackId="1" stroke={SEVERITY_COLORS.low}      fill={SEVERITY_COLORS.low}      fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Vulnerabilities by severity */}
              <ChartCard title="Vulnerability Count by Severity">
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} width={32} />
                    <RechartsTooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af' }} />
                    <Area type="monotone" dataKey="vuln_critical" name="Critical" stackId="1" stroke={SEVERITY_COLORS.critical} fill={SEVERITY_COLORS.critical} fillOpacity={0.3} />
                    <Area type="monotone" dataKey="vuln_high"     name="High"     stackId="1" stroke={SEVERITY_COLORS.high}     fill={SEVERITY_COLORS.high}     fillOpacity={0.3} />
                    <Area type="monotone" dataKey="vuln_medium"   name="Medium"   stackId="1" stroke={SEVERITY_COLORS.medium}   fill={SEVERITY_COLORS.medium}   fillOpacity={0.3} />
                    <Area type="monotone" dataKey="vuln_low"      name="Low"      stackId="1" stroke={SEVERITY_COLORS.low}      fill={SEVERITY_COLORS.low}      fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Average complexity */}
              <ChartCard title="Average Complexity">
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} width={40} />
                    <RechartsTooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="avg_complexity" name="Avg Complexity" stroke="#818cf8" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* File count */}
              <ChartCard title="File Count">
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} allowDecimals={false} width={40} />
                    <RechartsTooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="file_count" name="Files" stroke="#34d399" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Total LOC */}
              <ChartCard title="Total Lines of Code">
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} width={52} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                    <RechartsTooltip content={<CustomTooltip />} />
                    <Line type="monotone" dataKey="total_loc" name="LOC" stroke="#60a5fa" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          )}
        </>
      )}
    </div>
  );
}
