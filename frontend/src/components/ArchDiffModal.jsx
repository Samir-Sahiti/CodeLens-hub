/**
 * ArchDiffModal — US-051: Architectural diff between branches or commits.
 *
 * A full-screen overlay that lets the user compare two git refs and see
 * the structural changes: added / removed / modified files, edge changes,
 * new issues introduced, and a per-file complexity delta table.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import {
  Button, Badge, EmptyState, Panel,
} from './ui/Primitives';
import {
  X, GitCompare, GitBranch, Plus, Minus, AlertTriangle,
  FileCode, ArrowRight, TrendingUp, TrendingDown,
  GitMerge, FileWarning, Link2, RefreshCw, Info, Check, ChevronDown,
} from './ui/Icons';

// ── Branch picker combobox ────────────────────────────────────────────────

function BranchPicker({ value, onChange, branches, loading, placeholder, label, autoFocus }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);

  // Sync external value → internal query (so the displayed text stays in sync)
  useEffect(() => { setQuery(value); }, [value]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = query.trim()
    ? branches.filter((b) => b.toLowerCase().includes(query.trim().toLowerCase()))
    : branches;

  const handleSelect = (branch) => {
    onChange(branch);
    setQuery(branch);
    setOpen(false);
  };

  const handleInputChange = (e) => {
    setQuery(e.target.value);
    onChange(e.target.value);
    setOpen(true);
  };

  return (
    <div className="flex flex-col gap-1 min-w-0" ref={containerRef}>
      {label && <label className="text-xs text-gray-500 font-medium">{label}</label>}
      <div className="relative">
        <GitBranch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500 z-10" />
        <input
          className="h-9 w-52 rounded-lg border border-gray-700 bg-gray-800 pl-8 pr-8 text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); e.stopPropagation(); }
            if (e.key === 'Enter') setOpen(false);
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
        <button
          tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
        >
          {loading
            ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-gray-500 border-t-transparent" />
            : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {open && (
          <ul className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900 shadow-xl py-1">
            {loading && (
              <li className="px-3 py-2 text-xs text-gray-500">Loading branches…</li>
            )}
            {!loading && filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-gray-500">
                {query ? `No match — "${query}" will be used as-is` : 'No branches found'}
              </li>
            )}
            {!loading && filtered.map((branch) => (
              <li
                key={branch}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(branch); }}
                className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer rounded transition-colors ${
                  value === branch ? 'bg-indigo-600/20 text-indigo-300' : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                <GitBranch className="h-3 w-3 text-gray-500 shrink-0" />
                <span className="flex-1 truncate font-mono text-xs">{branch}</span>
                {value === branch && <Check className="h-3.5 w-3.5 text-indigo-400 shrink-0" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function basename(filePath) {
  const parts = (filePath || '').replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

function statusColor(status) {
  switch (status) {
    case 'added':    return 'text-emerald-400';
    case 'removed':  return 'text-red-400';
    case 'modified': return 'text-amber-400';
    default:         return 'text-gray-500';
  }
}

function statusBg(status) {
  switch (status) {
    case 'added':    return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300';
    case 'removed':  return 'bg-red-500/10 border-red-500/20 text-red-300';
    case 'modified': return 'bg-amber-500/10 border-amber-500/20 text-amber-300';
    default:         return 'bg-gray-800/50 border-gray-700/50 text-gray-400';
  }
}

function statusLabel(status) {
  switch (status) {
    case 'added':    return '+added';
    case 'removed':  return '−removed';
    case 'modified': return '~modified';
    default:         return 'unchanged';
  }
}

function issueIcon(type) {
  switch (type) {
    case 'god_file':      return FileWarning;
    case 'high_coupling': return Link2;
    case 'circular_dependency': return GitMerge;
    default:              return AlertTriangle;
  }
}

function severityBadge(severity) {
  switch (severity) {
    case 'high':   return 'bg-red-500/15 text-red-300 border border-red-500/25';
    case 'medium': return 'bg-amber-500/15 text-amber-300 border border-amber-500/25';
    default:       return 'bg-blue-500/15 text-blue-300 border border-blue-500/25';
  }
}

// ── Stat card ─────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, tone = 'neutral' }) {
  const toneMap = {
    neutral: 'text-gray-300',
    green:   'text-emerald-400',
    red:     'text-red-400',
    amber:   'text-amber-400',
    blue:    'text-blue-400',
    purple:  'text-purple-400',
  };
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3 min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 uppercase tracking-wider">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <span className={`text-2xl font-bold tabular-nums ${toneMap[tone]}`}>{value}</span>
    </div>
  );
}

// ── File row ──────────────────────────────────────────────────────────────

function FileRow({ node }) {
  if (node.status === 'unchanged') return null;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-800/50 last:border-0 text-sm">
      <span className={`font-mono text-xs px-1.5 py-0.5 rounded border ${statusBg(node.status)}`}>
        {statusLabel(node.status)}
      </span>
      <span className="flex-1 min-w-0 truncate text-gray-300 font-mono text-xs" title={node.file_path}>
        {node.file_path}
      </span>
      {node.status !== 'removed' && typeof node.complexity_score === 'number' && (
        <span className="text-xs text-gray-500 tabular-nums shrink-0">
          cx {node.complexity_score}
          {node.status === 'modified' && typeof node.base_complexity === 'number' && node.base_complexity !== node.complexity_score && (
            <span className={node.complexity_score > node.base_complexity ? 'text-amber-400 ml-1' : 'text-emerald-400 ml-1'}>
              ({node.complexity_score > node.base_complexity ? '+' : ''}{node.complexity_score - node.base_complexity})
            </span>
          )}
        </span>
      )}
      {typeof node.line_count === 'number' && node.line_count > 0 && (
        <span className="text-xs text-gray-600 tabular-nums shrink-0">{node.line_count} lines</span>
      )}
    </div>
  );
}

// ── Edge row ──────────────────────────────────────────────────────────────

function EdgeRow({ edge, kind }) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-gray-800/40 last:border-0 text-xs font-mono">
      <span className={kind === 'added' ? 'text-emerald-400 shrink-0' : 'text-red-400 shrink-0'}>
        {kind === 'added' ? '+' : '−'}
      </span>
      <span className="truncate text-gray-400 min-w-0" title={edge.from_path}>{basename(edge.from_path)}</span>
      <ArrowRight className="h-3 w-3 text-gray-600 shrink-0" />
      <span className="truncate text-gray-400 min-w-0" title={edge.to_path}>{basename(edge.to_path)}</span>
    </div>
  );
}

// ── Issue row ──────────────────────────────────────────────────────────────

function IssueRow({ issue }) {
  const Icon = issueIcon(issue.type);
  return (
    <div className="flex items-start gap-3 py-2 border-b border-gray-800/40 last:border-0">
      <Icon className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-0.5">
          <span className={`text-xs px-1.5 py-0.5 rounded ${severityBadge(issue.severity)}`}>
            {issue.severity}
          </span>
          <span className="text-xs text-gray-500 font-mono">{issue.type.replace(/_/g, ' ')}</span>
        </div>
        <p className="text-xs text-gray-400 font-mono truncate" title={issue.description}>{issue.description}</p>
      </div>
    </div>
  );
}

// ── Diff graph (simple SVG force layout) ─────────────────────────────────

function DiffGraph({ nodes, edges }) {
  const svgRef = useRef(null);
  const animRef = useRef(null);

  const changedNodes = nodes.filter((n) => n.status !== 'unchanged');
  const changedPaths = new Set(changedNodes.map((n) => n.file_path));

  // Include edges that connect to/from changed nodes
  const relevantEdges = [
    ...edges.added.map((e) => ({ ...e, kind: 'added' })),
    ...edges.removed.map((e) => ({ ...e, kind: 'removed' })),
  ].filter((e) => changedPaths.has(e.from_path) || changedPaths.has(e.to_path));

  // Build a display node set: changed nodes + direct neighbours referenced by edges
  const displayPaths = new Set(changedPaths);
  for (const e of relevantEdges) {
    displayPaths.add(e.from_path);
    displayPaths.add(e.to_path);
  }

  const nodeList = [...displayPaths].slice(0, 80).map((p, i) => {
    const info = nodes.find((n) => n.file_path === p);
    return {
      id: p,
      label: basename(p),
      status: info?.status || 'unchanged',
      index: i,
    };
  });

  const nodeIndex = new Map(nodeList.map((n) => [n.id, n]));

  const edgeList = relevantEdges
    .filter((e) => nodeIndex.has(e.from_path) && nodeIndex.has(e.to_path))
    .slice(0, 150)
    .map((e) => ({ source: nodeIndex.get(e.from_path), target: nodeIndex.get(e.to_path), kind: e.kind }));

  // Simple spring simulation
  useEffect(() => {
    if (!svgRef.current || nodeList.length === 0) return;

    const W = svgRef.current.clientWidth || 600;
    const H = svgRef.current.clientHeight || 400;
    const cx = W / 2;
    const cy = H / 2;

    // Initialise positions in a circle
    nodeList.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / nodeList.length;
      const r = Math.min(W, H) * 0.35;
      n.x = cx + r * Math.cos(angle);
      n.y = cy + r * Math.sin(angle);
      n.vx = 0;
      n.vy = 0;
    });

    const repulsion = 600;
    const spring   = 0.04;
    const restLen  = 80;
    const damping  = 0.85;
    let tick = 0;

    function step() {
      if (tick++ > 120) return; // run 120 frames then stop

      // Repulsion
      for (let i = 0; i < nodeList.length; i++) {
        for (let j = i + 1; j < nodeList.length; j++) {
          const a = nodeList[i];
          const b = nodeList[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
          const force = repulsion / (dist * dist);
          a.vx -= (dx / dist) * force;
          a.vy -= (dy / dist) * force;
          b.vx += (dx / dist) * force;
          b.vy += (dy / dist) * force;
        }
      }

      // Spring attraction along edges
      for (const e of edgeList) {
        const dx = e.target.x - e.source.x;
        const dy = e.target.y - e.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const force = (dist - restLen) * spring;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        e.source.vx += fx;
        e.source.vy += fy;
        e.target.vx -= fx;
        e.target.vy -= fy;
      }

      // Gravity toward centre
      for (const n of nodeList) {
        n.vx += (cx - n.x) * 0.008;
        n.vy += (cy - n.y) * 0.008;
        n.vx *= damping;
        n.vy *= damping;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(20, Math.min(W - 20, n.x));
        n.y = Math.max(20, Math.min(H - 20, n.y));
      }

      render();
      animRef.current = requestAnimationFrame(step);
    }

    const svg = svgRef.current;

    function render() {
      // Clear
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttribute('id', 'arrow');
      marker.setAttribute('markerWidth', '6');
      marker.setAttribute('markerHeight', '6');
      marker.setAttribute('refX', '5');
      marker.setAttribute('refY', '3');
      marker.setAttribute('orient', 'auto');
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', '0 0, 6 3, 0 6');
      poly.setAttribute('fill', '#6b7280');
      marker.appendChild(poly);
      defs.appendChild(marker);
      svg.appendChild(defs);

      // Draw edges
      for (const e of edgeList) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', e.source.x);
        line.setAttribute('y1', e.source.y);
        line.setAttribute('x2', e.target.x);
        line.setAttribute('y2', e.target.y);
        line.setAttribute('stroke', e.kind === 'added' ? '#34d399' : '#f87171');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-opacity', '0.6');
        if (e.kind === 'removed') line.setAttribute('stroke-dasharray', '4 2');
        line.setAttribute('marker-end', 'url(#arrow)');
        svg.appendChild(line);
      }

      // Draw nodes
      for (const n of nodeList) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', n.x);
        circle.setAttribute('cy', n.y);
        circle.setAttribute('r', '8');

        const fillMap = { added: '#34d399', removed: '#f87171', modified: '#fbbf24', unchanged: '#374151' };
        const opacityMap = { added: '1', removed: '1', modified: '1', unchanged: '0.35' };
        circle.setAttribute('fill', fillMap[n.status] || '#374151');
        circle.setAttribute('fill-opacity', opacityMap[n.status] || '1');
        circle.setAttribute('stroke', fillMap[n.status] || '#374151');
        circle.setAttribute('stroke-width', '1.5');
        circle.setAttribute('stroke-opacity', '0.8');
        g.appendChild(circle);

        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', n.x);
        text.setAttribute('y', n.y + 20);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#9ca3af');
        text.setAttribute('font-size', '8');
        text.setAttribute('font-family', 'ui-monospace, monospace');
        text.textContent = n.label.length > 14 ? n.label.slice(0, 12) + '…' : n.label;
        g.appendChild(text);

        svg.appendChild(g);
      }
    }

    animRef.current = requestAnimationFrame(step);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeList.length, edgeList.length]);

  if (nodeList.length === 0) {
    return (
      <EmptyState
        icon={GitCompare}
        title="No changed files to visualize"
        description="All files are identical between the selected refs."
        className="py-20"
      />
    );
  }

  return (
    <div className="relative rounded-xl border border-gray-800 bg-gray-950 overflow-hidden" style={{ height: 420 }}>
      <div className="absolute top-2 right-2 z-10 flex flex-wrap gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-emerald-400" /> added</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-red-400" /> removed</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-amber-400" /> modified</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-gray-700 opacity-35" /> unchanged</span>
      </div>
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ArchDiffModal({ repoId, defaultBranch = 'main', onClose }) {
  const { session } = useAuth();
  const [baseRef, setBaseRef] = useState(defaultBranch);
  const [headRef, setHeadRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [diff, setDiff]   = useState(null);
  const [error, setError] = useState(null);
  const [view, setView]   = useState('summary');

  const [branches, setBranches]           = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);

  // Fetch branch list once on mount
  useEffect(() => {
    if (!session?.access_token) return;
    fetch(apiUrl(`/api/repos/${repoId}/branches`), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => setBranches(data.branches || []))
      .catch(() => {})
      .finally(() => setBranchesLoading(false));
  }, [repoId, session?.access_token]);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const runDiff = useCallback(async () => {
    if (!baseRef.trim() || !headRef.trim()) return;
    setLoading(true);
    setError(null);
    setDiff(null);
    setView('summary');
    try {
      const res = await fetch(
        apiUrl(`/api/repos/${repoId}/diff?base=${encodeURIComponent(baseRef.trim())}&head=${encodeURIComponent(headRef.trim())}`),
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to compute diff');
      setDiff(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [repoId, baseRef, headRef, session?.access_token]);

  const s = diff?.summary;
  const changedNodes = diff ? diff.nodes.filter((n) => n.status !== 'unchanged') : [];

  const VIEWS = [
    { id: 'summary',    label: 'Summary' },
    { id: 'graph',      label: 'Graph' },
    { id: 'files',      label: `Files (${s ? s.added_files + s.removed_files + s.modified_files : 0})` },
    { id: 'edges',      label: `Edges (${s ? s.added_edges + s.removed_edges : 0})` },
    { id: 'issues',     label: `New Issues (${s?.new_issues?.length ?? 0})` },
    { id: 'complexity', label: `Complexity (${s?.complexity_deltas?.length ?? 0})` },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex flex-col w-full max-w-5xl max-h-[90vh] rounded-2xl border border-gray-800 bg-surface-900 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-white">Architectural Diff</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Ref selector */}
        <div className="flex items-end gap-3 px-6 py-4 border-b border-gray-800 bg-gray-900/40 shrink-0 flex-wrap">
          <BranchPicker
            label="Base"
            value={baseRef}
            onChange={setBaseRef}
            branches={branches}
            loading={branchesLoading}
            placeholder={defaultBranch}
          />

          <ArrowRight className="h-4 w-4 text-gray-600 mb-2 shrink-0" />

          <BranchPicker
            label="Head"
            value={headRef}
            onChange={setHeadRef}
            branches={branches}
            loading={branchesLoading}
            placeholder="feature/my-branch or SHA"
            autoFocus
          />

          <Button
            onClick={runDiff}
            disabled={loading || !baseRef.trim() || !headRef.trim()}
            loading={loading}
            icon={loading ? RefreshCw : GitCompare}
            className="shrink-0"
          >
            {loading ? 'Comparing…' : 'Compare'}
          </Button>

          {diff && (
            <span className="text-xs text-gray-500 font-mono self-end mb-2 truncate">
              {diff.base_sha.slice(0, 7)}…{diff.head_sha.slice(0, 7)}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="mx-6 mt-4 rounded-lg bg-red-950/30 border border-red-800/40 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {!diff && !loading && !error && (
            <EmptyState
              icon={GitCompare}
              title="Compare two refs"
              description="Enter a base and head branch name (or commit SHA) and click Compare to see architectural changes."
              className="py-24"
            />
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-24 gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
              <p className="text-sm text-gray-400">Fetching file trees and parsing changes…</p>
            </div>
          )}

          {diff && diff.identical && (
            <EmptyState
              icon={GitCompare}
              title="Refs are identical"
              description={`Both refs resolve to the same commit (${diff.base_sha.slice(0, 7)}).`}
              className="py-24"
            />
          )}

          {diff && !diff.identical && (
            <div className="flex flex-col gap-0">
              {/* Summary stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 px-6 pt-5 pb-4">
                <StatCard label="Files added"   value={`+${s.added_files}`}   icon={Plus}        tone="green"  />
                <StatCard label="Files removed" value={`−${s.removed_files}`} icon={Minus}       tone="red"    />
                <StatCard label="Files changed" value={s.modified_files}       icon={FileCode}    tone="amber"  />
                <StatCard label="Edges added"   value={`+${s.added_edges}`}   icon={Plus}        tone="green"  />
                <StatCard label="Edges removed" value={`−${s.removed_edges}`} icon={Minus}       tone="red"    />
                <StatCard label="New issues"    value={s.new_issues.length}    icon={AlertTriangle} tone={s.new_issues.length ? 'amber' : 'neutral'} />
              </div>

              {/* Prose summary */}
              <div className="mx-6 mb-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3 text-sm text-indigo-200 flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 mt-0.5 text-indigo-400" />
                <span>
                  <strong>{baseRef}</strong> → <strong>{headRef}</strong>:{' '}
                  {s.added_files > 0 && `+${s.added_files} file${s.added_files > 1 ? 's' : ''}, `}
                  {s.removed_files > 0 && `−${s.removed_files} file${s.removed_files > 1 ? 's' : ''}, `}
                  {s.modified_files > 0 && `~${s.modified_files} modified, `}
                  {s.added_edges > 0 && `+${s.added_edges} edge${s.added_edges > 1 ? 's' : ''}, `}
                  {s.removed_edges > 0 && `−${s.removed_edges} edge${s.removed_edges > 1 ? 's' : ''}, `}
                  {s.new_issues.length > 0
                    ? `${s.new_issues.length} new issue${s.new_issues.length > 1 ? 's' : ''} introduced`
                    : 'no new issues introduced'}
                  {s.unchanged_files > 0 && `, ${s.unchanged_files} files unchanged`}.
                </span>
              </div>

              {/* View tabs */}
              <div className="flex gap-1 px-6 pb-3 overflow-x-auto shrink-0">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setView(v.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                      view === v.id
                        ? 'bg-indigo-600/25 text-indigo-300 border border-indigo-500/30'
                        : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              <div className="px-6 pb-6">
                {/* Summary view */}
                {view === 'summary' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Changed files preview */}
                    <Panel padded={false}>
                      <div className="px-4 py-3 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        Changed Files ({changedNodes.length})
                      </div>
                      <div className="px-4 py-2 max-h-52 overflow-y-auto">
                        {changedNodes.length === 0
                          ? <p className="text-xs text-gray-600 py-2">No file changes</p>
                          : changedNodes.slice(0, 20).map((n) => <FileRow key={n.file_path} node={n} />)}
                        {changedNodes.length > 20 && (
                          <p className="text-xs text-gray-600 pt-2">…and {changedNodes.length - 20} more. See the Files tab.</p>
                        )}
                      </div>
                    </Panel>

                    {/* New issues preview */}
                    <Panel padded={false}>
                      <div className="px-4 py-3 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        New Issues ({s.new_issues.length})
                      </div>
                      <div className="px-4 py-2 max-h-52 overflow-y-auto">
                        {s.new_issues.length === 0
                          ? <p className="text-xs text-gray-600 py-2">No new architectural issues introduced</p>
                          : s.new_issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}
                      </div>
                    </Panel>

                    {/* Complexity deltas preview */}
                    {s.complexity_deltas.length > 0 && (
                      <Panel padded={false} className="md:col-span-2">
                        <div className="px-4 py-3 border-b border-gray-800 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                          Top Complexity Changes
                        </div>
                        <div className="px-4 py-2">
                          {s.complexity_deltas.slice(0, 6).map((d) => (
                            <div key={d.file_path} className="flex items-center gap-3 py-1.5 border-b border-gray-800/40 last:border-0 text-xs">
                              {d.delta > 0
                                ? <TrendingUp className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                                : <TrendingDown className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                              <span className="flex-1 truncate font-mono text-gray-400" title={d.file_path}>{d.file_path}</span>
                              <span className="tabular-nums text-gray-500">{d.base_complexity} → {d.head_complexity}</span>
                              <span className={`tabular-nums font-semibold ${d.delta > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {d.delta > 0 ? '+' : ''}{d.delta}
                              </span>
                            </div>
                          ))}
                        </div>
                      </Panel>
                    )}
                  </div>
                )}

                {/* Graph view — key on SHAs so a new diff always creates a fresh simulation */}
                {view === 'graph' && (
                  <DiffGraph
                    key={`${diff.base_sha}-${diff.head_sha}`}
                    nodes={diff.nodes}
                    edges={diff.edges}
                  />
                )}

                {/* Files view */}
                {view === 'files' && (
                  <Panel padded={false}>
                    <div className="px-4 py-2 max-h-[calc(90vh-22rem)] overflow-y-auto">
                      {changedNodes.length === 0
                        ? <p className="text-xs text-gray-600 py-4 text-center">No changed files</p>
                        : changedNodes.map((n) => <FileRow key={n.file_path} node={n} />)}
                    </div>
                  </Panel>
                )}

                {/* Edges view */}
                {view === 'edges' && (
                  <Panel padded={false}>
                    <div className="px-4 py-2 max-h-[calc(90vh-22rem)] overflow-y-auto">
                      {diff.edges.added.length === 0 && diff.edges.removed.length === 0 ? (
                        <p className="text-xs text-gray-600 py-4 text-center">No edge changes</p>
                      ) : (
                        <>
                          {diff.edges.added.map((e, i) => <EdgeRow key={`a-${i}`} edge={e} kind="added" />)}
                          {diff.edges.removed.map((e, i) => <EdgeRow key={`r-${i}`} edge={e} kind="removed" />)}
                        </>
                      )}
                    </div>
                  </Panel>
                )}

                {/* Issues view */}
                {view === 'issues' && (
                  <Panel padded={false}>
                    <div className="px-4 py-2 max-h-[calc(90vh-22rem)] overflow-y-auto">
                      {s.new_issues.length === 0
                        ? <p className="text-xs text-gray-600 py-4 text-center">No new architectural issues introduced</p>
                        : s.new_issues.map((issue, i) => <IssueRow key={i} issue={issue} />)}
                    </div>
                  </Panel>
                )}

                {/* Complexity view */}
                {view === 'complexity' && (
                  <Panel padded={false}>
                    <div className="max-h-[calc(90vh-22rem)] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                          <tr>
                            <th className="text-left px-4 py-2 text-gray-500 font-medium">File</th>
                            <th className="text-right px-4 py-2 text-gray-500 font-medium">Base cx</th>
                            <th className="text-right px-4 py-2 text-gray-500 font-medium">Head cx</th>
                            <th className="text-right px-4 py-2 text-gray-500 font-medium">Δ</th>
                            <th className="text-right px-4 py-2 text-gray-500 font-medium">Lines Δ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.complexity_deltas.length === 0 ? (
                            <tr><td colSpan={5} className="text-center text-gray-600 py-4">No complexity changes</td></tr>
                          ) : s.complexity_deltas.map((d) => (
                            <tr key={d.file_path} className="border-b border-gray-800/40 hover:bg-gray-800/30">
                              <td className="px-4 py-2 font-mono truncate max-w-xs text-gray-400" title={d.file_path}>{d.file_path}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-gray-500">{d.base_complexity}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-gray-400">{d.head_complexity}</td>
                              <td className={`px-4 py-2 text-right tabular-nums font-semibold ${d.delta > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {d.delta > 0 ? '+' : ''}{d.delta}
                              </td>
                              <td className={`px-4 py-2 text-right tabular-nums ${d.head_lines - d.base_lines > 0 ? 'text-amber-400/70' : 'text-emerald-400/70'}`}>
                                {d.head_lines - d.base_lines > 0 ? '+' : ''}{d.head_lines - d.base_lines}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
