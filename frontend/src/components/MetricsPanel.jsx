import { useState, useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import VirtualTable from './VirtualTable';
import { LANGUAGE_COLORS, formatLanguage } from '../lib/constants';
import { ArrowDown, ArrowUp, Search, X } from './ui/Icons';

// ── Sub-component: language distribution with optional "show all" ─────────────
function LangDistributionCard({ langCounts }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? langCounts : langCounts.slice(0, 5);
  const hasMore = langCounts.length > 5;

  return (
    <div className="flex min-w-0 flex-col justify-center rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-3" style={{ borderTopColor: '#6366f1', borderTopWidth: 2 }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Languages</p>
        {hasMore && (
          <button onClick={() => setShowAll(v => !v)} className="text-[10px] text-indigo-400 hover:text-indigo-300 transition">
            {showAll ? 'Show less' : `+${langCounts.length - 5} more`}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map(([lang, count]) => (
          <span
            key={lang}
            className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-gray-300"
            style={{
              backgroundColor: (LANGUAGE_COLORS[lang] || LANGUAGE_COLORS.unknown) + '25',
              border: `1px solid ${(LANGUAGE_COLORS[lang] || LANGUAGE_COLORS.unknown)}50`,
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: LANGUAGE_COLORS[lang] || LANGUAGE_COLORS.unknown }} />
            {formatLanguage(lang)}
            <span className="text-gray-500">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}


export default function MetricsPanel({ nodes, selectedNode, onNodeSelect, onAnalyseImpact }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'complexity_score', direction: 'desc' });
  const [showHistogram, setShowHistogram] = useState(false);
  const [complexityFilter, setComplexityFilter] = useState(null);

  const ringRef = useRef(null);
  const histRef = useRef(null);

  const calc90th = (arr, key) => {
    if (!arr || arr.length === 0) return 0;
    const sortedVals = arr.map((n) => n[key] || 0).sort((a, b) => a - b);
    const index = Math.floor(0.9 * sortedVals.length);
    return sortedVals[Math.min(index, sortedVals.length - 1)] || 0;
  };

  const p90Complexity = useMemo(() => calc90th(nodes, 'complexity_score'), [nodes]);
  const p90Incoming = useMemo(() => calc90th(nodes, 'incoming_count'), [nodes]);

  const { criticalCount, atRiskCount, totalLines, avgComplexity, langCounts } = useMemo(() => {
    let critical = 0;
    let atRisk = 0;
    let lines = 0;
    let complexitySum = 0;
    const langs = {};
    nodes.forEach((n) => {
      const isHighComplex = n.complexity_score > p90Complexity;
      const isHighIncoming = n.incoming_count > p90Incoming;
      if (isHighComplex && isHighIncoming) critical++;
      else if (isHighComplex || isHighIncoming) atRisk++;
      lines += n.line_count || 0;
      complexitySum += n.complexity_score || 0;
      const lang = n.language || 'unknown';
      langs[lang] = (langs[lang] || 0) + 1;
    });
    return {
      criticalCount: critical,
      atRiskCount: atRisk,
      totalLines: lines,
      avgComplexity: nodes.length > 0 ? complexitySum / nodes.length : 0,
      langCounts: Object.entries(langs).sort((a, b) => b[1] - a[1]),
    };
  }, [nodes, p90Complexity, p90Incoming]);

  const healthScore = useMemo(() => {
    if (nodes.length === 0) return 100;
    return Math.max(0, Math.min(100, Math.round(100 - (criticalCount / nodes.length) * 100 * 2 - (atRiskCount / nodes.length) * 100 * 0.5)));
  }, [nodes.length, criticalCount, atRiskCount]);

  const scoreColor = healthScore >= 80 ? '#22c55e' : healthScore >= 50 ? '#f59e0b' : '#ef4444';

  // Column maxes for spark bars
  const maxLineCount = useMemo(() => Math.max(1, ...nodes.map((n) => n.line_count || 0)), [nodes]);
  const maxOutgoing = useMemo(() => Math.max(1, ...nodes.map((n) => n.outgoing_count || 0)), [nodes]);
  const maxIncoming = useMemo(() => Math.max(1, ...nodes.map((n) => n.incoming_count || 0)), [nodes]);
  const maxComplexity = useMemo(() => Math.max(1, ...nodes.map((n) => n.complexity_score || 0)), [nodes]);

  // D3 ring chart
  useEffect(() => {
    if (!ringRef.current || nodes.length === 0) return;
    const svg = d3.select(ringRef.current);
    svg.selectAll('*').remove();
    const size = 72;
    const r = size / 2;
    const inner = r * 0.58;
    const outer = r * 0.88;
    const healthy = Math.max(0, nodes.length - criticalCount - atRiskCount);
    const data = [
      { v: criticalCount, c: '#ef4444' },
      { v: atRiskCount, c: '#f59e0b' },
      { v: healthy, c: '#22c55e' },
    ].filter((d) => d.v > 0);
    const safeData = data.length > 0 ? data : [{ v: 1, c: '#22c55e' }];
    const pie = d3.pie().value((d) => d.v).sort(null).padAngle(0.04);
    const arc = d3.arc().innerRadius(inner).outerRadius(outer).cornerRadius(2);
    const g = svg.append('g').attr('transform', `translate(${r},${r})`);
    g.selectAll('path')
      .data(pie(safeData))
      .join('path')
      .attr('d', arc)
      .attr('fill', (d) => d.data.c)
      .attr('opacity', 0.9);
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', scoreColor)
      .attr('font-size', '14px')
      .attr('font-weight', '700')
      .attr('font-family', 'ui-sans-serif, system-ui, sans-serif')
      .text(`${healthScore}%`);
  }, [nodes, criticalCount, atRiskCount, healthScore, scoreColor]);

  // D3 histogram
  useEffect(() => {
    if (!showHistogram || !histRef.current || nodes.length === 0) return;
    const container = histRef.current;
    const width = container.clientWidth || 400;
    const height = 110;
    const margin = { top: 8, right: 12, bottom: 28, left: 28 };

    const values = nodes.map((n) => n.complexity_score || 0);
    const x = d3.scaleLinear()
      .domain([0, d3.max(values) * 1.05])
      .nice()
      .range([margin.left, width - margin.right]);

    const bins = d3.bin().value((d) => d).domain(x.domain()).thresholds(x.ticks(18))(values);

    const y = d3.scaleLinear()
      .domain([0, d3.max(bins, (d) => d.length)])
      .nice()
      .range([height - margin.bottom, margin.top]);

    const svg = d3.select(container);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const barColor = (bin) => {
      const mid = (bin.x0 + bin.x1) / 2;
      if (mid > p90Complexity) return '#ef4444';
      if (mid > p90Complexity * 0.65) return '#f59e0b';
      return '#22c55e';
    };

    svg.selectAll('rect')
      .data(bins)
      .join('rect')
      .attr('x', (d) => x(d.x0) + 1)
      .attr('width', (d) => Math.max(0, x(d.x1) - x(d.x0) - 2))
      .attr('y', (d) => y(d.length))
      .attr('height', (d) => Math.max(0, y(0) - y(d.length)))
      .attr('fill', barColor)
      .attr('rx', 2)
      .attr('opacity', (d) => complexityFilter?.x0 === d.x0 ? 1 : 0.7)
      .attr('stroke', (d) => complexityFilter?.x0 === d.x0 ? '#6366f1' : 'transparent')
      .attr('stroke-width', 2)
      .attr('cursor', 'pointer')
      .on('click', (_event, d) => {
        setComplexityFilter((cf) => cf?.x0 === d.x0 ? null : d);
      });

    const xAxis = d3.axisBottom(x).ticks(5).tickSize(3);
    svg.append('g')
      .attr('transform', `translate(0,${height - margin.bottom})`)
      .call(xAxis)
      .call((g) => g.select('.domain').attr('stroke', '#374151'))
      .call((g) => g.selectAll('.tick line').attr('stroke', '#374151'))
      .call((g) => g.selectAll('text').attr('fill', '#6b7280').attr('font-size', '10px'));

    const yAxis = d3.axisLeft(y).ticks(3).tickSize(3);
    svg.append('g')
      .attr('transform', `translate(${margin.left},0)`)
      .call(yAxis)
      .call((g) => g.select('.domain').attr('stroke', '#374151'))
      .call((g) => g.selectAll('.tick line').attr('stroke', '#374151'))
      .call((g) => g.selectAll('text').attr('fill', '#6b7280').attr('font-size', '10px'));
  }, [showHistogram, nodes, p90Complexity, complexityFilter]);

  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((n) => n.file_path.toLowerCase().includes(q));
    }
    if (complexityFilter) {
      result = result.filter((n) => (n.complexity_score || 0) >= complexityFilter.x0 && (n.complexity_score || 0) < complexityFilter.x1);
    }
    return result;
  }, [nodes, searchQuery, complexityFilter]);

  const sortedNodes = useMemo(() => [...filteredNodes].sort((a, b) => {
    const valA = a[sortConfig.key] || 0;
    const valB = b[sortConfig.key] || 0;
    if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  }), [filteredNodes, sortConfig]);

  const handleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      return { key, direction: 'desc' };
    });
  };

  const renderSortIcon = (columnKey) => {
    if (sortConfig.key !== columnKey) return <span className="ml-2 inline-block h-3 w-3 rounded-full border border-gray-700/80 align-middle" />;
    const Icon = sortConfig.direction === 'asc' ? ArrowUp : ArrowDown;
    return <Icon className="ml-2 inline h-3.5 w-3.5 align-middle text-indigo-300" />;
  };

  return (
    <div
      className="flex h-auto min-h-[30rem] flex-col gap-3 xl:h-[calc(100vh-12rem)]"
      style={{ background: 'radial-gradient(ellipse at top, rgba(99,102,241,0.06), transparent 60%)' }}
    >
      {/* ── Summary cards row ── */}
      <div className="grid shrink-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {/* Health score ring */}
        <div className="flex min-w-0 items-center gap-4 rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-3">
          <svg ref={ringRef} width="72" height="72" />
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-0.5">Health Score</p>
            <p className="text-xl font-bold" style={{ color: scoreColor }}>{healthScore}%</p>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="text-red-400">{criticalCount} critical</span>
              {' · '}
              <span className="text-yellow-400">{atRiskCount} at-risk</span>
            </p>
          </div>
        </div>

        {/* Total LOC */}
        <div className="flex min-w-0 flex-col justify-center rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-3" style={{ borderTopColor: '#6366f1', borderTopWidth: 2 }}>
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-1">Total Lines</p>
          <p className="text-xl font-bold text-white">{totalLines.toLocaleString()}</p>
          <p className="text-xs text-gray-500 mt-0.5">{nodes.length} files</p>
        </div>

        {/* Avg complexity */}
        <div className="flex min-w-0 flex-col justify-center rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-3" style={{ borderTopColor: avgComplexity > p90Complexity ? '#ef4444' : avgComplexity > p90Complexity * 0.6 ? '#f59e0b' : '#22c55e', borderTopWidth: 2 }}>
          <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 mb-1">Avg Complexity</p>
          <p className="text-xl font-bold text-white">{avgComplexity.toFixed(1)}</p>
          <p className="text-xs text-gray-500 mt-0.5">p90 threshold: {p90Complexity.toFixed(0)}</p>
        </div>

        {/* Language distribution — with showAll toggle */}
        <LangDistributionCard langCounts={langCounts} />
      </div>

      {/* ── Table + sidebar ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 xl:flex-row">
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30 min-h-0">
          {/* Table toolbar */}
          <div className="flex shrink-0 flex-col gap-3 border-b border-gray-800 bg-gray-900/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => { setShowHistogram((v) => !v); if (showHistogram) setComplexityFilter(null); }}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${showHistogram ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300' : 'border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200'}`}
              >
                {showHistogram ? 'Hide chart' : 'Show distribution'}
              </button>
              {complexityFilter && (
                <button
                  onClick={() => setComplexityFilter(null)}
                  className="flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/20 transition"
                >
                  Complexity {complexityFilter.x0.toFixed(0)}–{complexityFilter.x1.toFixed(0)}
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <label className="flex w-full items-center gap-2 rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm text-white transition-colors focus-within:border-indigo-500 sm:w-72">
              <Search className="h-4 w-4 shrink-0 text-gray-500" />
              <input
                type="text"
                placeholder="Search by file path…"
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-gray-600"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </label>
          </div>

          {/* Histogram */}
          {showHistogram && (
            <div className="shrink-0 border-b border-gray-800 bg-gray-950/40 px-4 pt-3 pb-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Complexity distribution — click a bar to filter</p>
                {complexityFilter && <span className="text-[10px] text-indigo-400">Filtered: {sortedNodes.length} files</span>}
              </div>
              <svg ref={histRef} className="w-full" />
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-hidden min-h-0">
            <VirtualTable
              rows={sortedNodes}
              rowHeight={44}
              bufferRows={20}
              containerHeight="100%"
              tableClassName="w-full text-left text-sm table-fixed"
              colGroup={
                <colgroup>
                  <col style={{ width: '36%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '12%' }} />
                </colgroup>
              }
              renderHeader={() => (
                <thead className="bg-gray-800/95 backdrop-blur text-gray-300 z-10 shadow-sm border-b border-gray-700">
                  <tr>
                    <th onClick={() => handleSort('file_path')}>
                      File Path {renderSortIcon('file_path')}
                    </th>
                    <th onClick={() => handleSort('language')}>
                      Language {renderSortIcon('language')}
                    </th>
                    <th onClick={() => handleSort('line_count')}>
                      Lines {renderSortIcon('line_count')}
                    </th>
                    <th onClick={() => handleSort('outgoing_count')}>
                      Imports {renderSortIcon('outgoing_count')}
                    </th>
                    <th onClick={() => handleSort('incoming_count')}>
                      Dependents {renderSortIcon('incoming_count')}
                    </th>
                    <th onClick={() => handleSort('complexity_score')}>
                      Complexity {renderSortIcon('complexity_score')}
                    </th>
                  </tr>
                </thead>
              )}
              renderRow={(node, index, isFocused) => {
                const isHighComplex = node.complexity_score > p90Complexity;
                const isHighIncoming = node.incoming_count > p90Incoming;
                const isSelected = selectedNode && (selectedNode.id || selectedNode.file_path) === (node.id || node.file_path);

                let rowClass = 'hover:bg-gray-800/60 cursor-pointer transition-colors';
                let textFade = 'text-gray-300';
                let metaFade = 'text-gray-500';

                if (isHighComplex && isHighIncoming) {
                  rowClass = 'bg-red-900/30 hover:bg-red-900/50 cursor-pointer transition-colors';
                  textFade = 'text-red-100 font-medium';
                  metaFade = 'text-red-300';
                } else if (isHighComplex || isHighIncoming) {
                  rowClass = 'bg-yellow-900/20 hover:bg-yellow-900/40 cursor-pointer transition-colors';
                  textFade = 'text-yellow-100';
                  metaFade = 'text-yellow-300/80';
                }

                if (isSelected) rowClass = `${rowClass} ring-1 ring-inset ring-sky-400/70 bg-sky-500/10`;
                if (isFocused) rowClass = `${rowClass} outline outline-1 outline-offset-[-1px] outline-accent/70`;

                const complexityRatio = (node.complexity_score || 0) / maxComplexity;
                const complexityBarColor = complexityRatio > 0.7 ? '#ef4444' : complexityRatio > 0.4 ? '#f59e0b' : '#22c55e';

                return (
                  <tr
                    key={node.id || node.file_path}
                    aria-rowindex={index + 1}
                    onClick={() => onNodeSelect(node.id || node.file_path)}
                    className={rowClass}
                    style={{ height: 44 }}
                  >
                    <td className={`px-6 py-3 font-mono text-xs ${textFade} max-w-0`}>
                      <span className="block truncate" title={node.file_path}>{node.file_path}</span>
                    </td>
                    <td className={`px-6 py-3 ${metaFade}`}>{formatLanguage(node.language)}</td>
                    <td className="px-6 py-3 relative text-center">
                      <span className={metaFade}>{node.line_count}</span>
                      <div className="absolute bottom-0 left-0 h-0.5 rounded-full opacity-35 bg-sky-400" style={{ width: `${((node.line_count || 0) / maxLineCount) * 100}%` }} />
                    </td>
                    <td className="px-6 py-3 relative text-center">
                      <span className={metaFade}>{node.outgoing_count}</span>
                      <div className="absolute bottom-0 left-0 h-0.5 rounded-full opacity-35 bg-indigo-400" style={{ width: `${((node.outgoing_count || 0) / maxOutgoing) * 100}%` }} />
                    </td>
                    <td className="px-6 py-3 relative text-center">
                      <span className={metaFade}>{node.incoming_count}</span>
                      <div className="absolute bottom-0 left-0 h-0.5 rounded-full opacity-35 bg-violet-400" style={{ width: `${((node.incoming_count || 0) / maxIncoming) * 100}%` }} />
                    </td>
                    <td className="px-6 py-3 relative text-center">
                      <span className={`font-medium ${textFade}`}>{Number(node.complexity_score).toFixed(2)}</span>
                      <div className="absolute bottom-0 left-0 h-0.5 rounded-full opacity-40" style={{ width: `${complexityRatio * 100}%`, backgroundColor: complexityBarColor }} />
                    </td>
                  </tr>
                );
              }}
            />
            {sortedNodes.length === 0 && (
              <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
                {complexityFilter ? `No files in complexity range ${complexityFilter.x0.toFixed(0)}–${complexityFilter.x1.toFixed(0)}` : `No files matching "${searchQuery}"`}
              </div>
            )}
          </div>
        </div>

        {/* Details sidebar */}
        <aside
          className={`w-full shrink-0 rounded-2xl border border-gray-800 bg-gray-900/80 p-5 shadow-2xl shadow-black/20 transition-all duration-300 xl:w-72 ${
            selectedNode ? 'block translate-x-0 opacity-100' : 'hidden pointer-events-none translate-x-8 opacity-0 xl:block xl:-mr-72'
          }`}
        >
          {selectedNode && (
            <div className="flex h-full flex-col">
              <div className="mb-5">
                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">File Details</p>
                <h3 className="mt-2 break-all font-mono text-sm text-gray-100">{selectedNode.file_path}</h3>
              </div>

              <div className="space-y-3 text-sm">
                <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3" style={{ borderLeftColor: LANGUAGE_COLORS[selectedNode.language] || LANGUAGE_COLORS.unknown, borderLeftWidth: 3 }}>
                  <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Language</p>
                  <p className="mt-1 text-gray-100">{formatLanguage(selectedNode.language)}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Lines</p>
                    <p className="mt-1 text-lg font-semibold text-white">{selectedNode.line_count || 0}</p>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Complexity</p>
                    <p className="mt-1 text-lg font-semibold text-white">{Number(selectedNode.complexity_score || 0).toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Imports</p>
                    <p className="mt-1 text-lg font-semibold text-white">{selectedNode.outgoing_count || 0}</p>
                  </div>
                  <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Dependents</p>
                    <p className="mt-1 text-lg font-semibold text-white">{selectedNode.incoming_count || 0}</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => onAnalyseImpact(selectedNode)}
                className="mt-5 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-gray-950 transition hover:bg-amber-400"
              >
                Analyse impact
              </button>

              <p className="mt-auto pt-5 text-xs text-gray-500">
                Select a row to inspect a file, then launch blast radius analysis from here.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
