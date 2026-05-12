import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGraphSimulation } from '../hooks/useGraphSimulation';
import { LANGUAGE_COLORS, formatLanguage } from '../lib/constants';
import { ChevronDown, ChevronUp, CirclePercent, Download, Search, Shield, TrendingUp, X } from './ui/Icons';

function GraphLegend() {
  const items = [
    { label: 'JS / TS', color: LANGUAGE_COLORS.javascript },
    { label: 'Python', color: LANGUAGE_COLORS.python },
    { label: 'C#', color: LANGUAGE_COLORS.c_sharp },
    { label: 'Go', color: LANGUAGE_COLORS.go },
    { label: 'Java', color: LANGUAGE_COLORS.java },
    { label: 'Rust', color: LANGUAGE_COLORS.rust },
    { label: 'Ruby', color: LANGUAGE_COLORS.ruby },
    { label: 'Unknown', color: LANGUAGE_COLORS.unknown },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 rounded-full border border-gray-800 bg-gray-950/80 px-3 py-1">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function CoverageLegend() {
  const items = [
    { label: 'Covered', color: '#22c55e' },
    { label: 'Low coverage', color: '#facc15' },
    { label: 'Uncovered', color: '#ef4444' },
    { label: 'Test file', color: '#9ca3af', muted: true },
  ];

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2 rounded-full border border-gray-800 bg-gray-950/80 px-3 py-1">
          <span className={`h-2.5 w-2.5 rounded-full ${item.muted ? 'opacity-30' : ''}`} style={{ backgroundColor: item.color }} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function GraphToast({ message, visible }) {
  return (
    <div
      className={`pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-emerald-400/20 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-200 shadow-lg shadow-emerald-950/40 transition-all duration-200 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      {message}
    </div>
  );
}

function GraphDetailsPanel({ node, onChatWithFile, onAuditFile }) {
  return (
    <aside
      className={`w-full shrink-0 rounded-xl border border-surface-800 bg-surface-900/80 p-5 shadow-panel transition-all duration-200 xl:w-72 ${
        node ? 'block translate-x-0 opacity-100' : 'hidden pointer-events-none translate-x-8 opacity-0 xl:block xl:-mr-72'
      }`}
    >
      {node && (
        <div className="flex h-full flex-col">
          <div className="mb-5">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">File Details</p>
            <h3 className="mt-2 break-all font-mono text-sm text-gray-100">{node.file_path}</h3>
          </div>

          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
              <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Language</p>
              <p className="mt-1 text-gray-100">{formatLanguage(node.language)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Lines</p>
                <p className="mt-1 text-lg font-semibold text-white">{node.line_count || 0}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Complexity</p>
                <p className="mt-1 text-lg font-semibold text-white">{Number(node.complexity_score || 0).toFixed(2)}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Imports</p>
                <p className="mt-1 text-lg font-semibold text-white">{node.outgoing_count || 0}</p>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
                <p className="text-xs uppercase tracking-[0.16em] text-gray-500">Dependents</p>
                <p className="mt-1 text-lg font-semibold text-white">{node.incoming_count || 0}</p>
              </div>
            </div>
          </div>

          <button
            onClick={() => onChatWithFile?.(node.file_path)}
            className="mt-5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm font-semibold text-indigo-200 transition hover:bg-indigo-500/20"
          >
            Chat with this file
          </button>

          <button
            onClick={() => onAuditFile?.(node.file_path)}
            className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-500/20"
          >
            Audit this file
          </button>

          <div className="mt-auto pt-5 text-xs text-gray-500">
            Double-click any node to copy its file path.
          </div>
        </div>
      )}
    </aside>
  );
}

function ImpactAnalysisPanel({ impactAnalysis, onClearImpactAnalysis }) {
  const [showAllTransitive, setShowAllTransitive] = useState(false);

  useEffect(() => {
    setShowAllTransitive(false);
  }, [impactAnalysis?.sourcePath]);

  if (!impactAnalysis) return null;

  const isLargeBlastRadius = impactAnalysis.transitive.length > 100;
  const visibleTransitive = isLargeBlastRadius && !showAllTransitive
    ? impactAnalysis.transitive.slice(0, 25)
    : impactAnalysis.transitive;
  const hiddenCount = impactAnalysis.transitive.length - visibleTransitive.length;

  const handleCopyImpactList = async () => {
    const allPaths = [
      impactAnalysis.sourcePath,
      ...impactAnalysis.direct,
      ...impactAnalysis.transitive,
    ];

    try {
      await navigator.clipboard.writeText(allPaths.join('\n'));
    } catch (error) {
      console.error('Failed to copy impact list:', error);
    }
  };

  const handleExportJson = () => {
    const payload = JSON.stringify({
      source: impactAnalysis.sourcePath,
      direct: impactAnalysis.direct,
      transitive: impactAnalysis.transitive,
    }, null, 2);

    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${impactAnalysis.sourceName.replace(/[^\w.-]+/g, '_')}-impact.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="w-full shrink-0 rounded-xl border border-surface-800 bg-surface-900/80 p-5 shadow-panel transition-all duration-200 xl:w-80">
      <div className="flex h-full flex-col">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.2em] text-amber-400/80">Impact Analysis</p>
          <h3 className="mt-2 break-all font-mono text-sm text-gray-100">{impactAnalysis.sourcePath}</h3>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-red-200/70">Direct</p>
            <p className="mt-1 text-2xl font-semibold text-red-100">{impactAnalysis.direct.length}</p>
          </div>
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-amber-200/70">Transitive</p>
            <p className="mt-1 text-2xl font-semibold text-amber-100">{impactAnalysis.transitive.length}</p>
          </div>
        </div>

        {impactAnalysis.direct.length === 0 && impactAnalysis.transitive.length === 0 ? (
          <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            No files depend on this file - changes here are isolated.
          </div>
        ) : (
          <div className="mt-5 max-h-[26rem] space-y-4 overflow-y-auto pr-1 xl:max-h-none">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs uppercase tracking-[0.16em] text-gray-500">Directly Affected Files</h4>
                <span className="text-xs text-red-300">{impactAnalysis.direct.length}</span>
              </div>
              <div className="space-y-2">
                {impactAnalysis.direct.map((filePath) => (
                  <div key={filePath} className="rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 font-mono text-xs text-red-100">
                    {filePath}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs uppercase tracking-[0.16em] text-gray-500">Transitively Affected Files</h4>
                <button
                  onClick={() => setShowAllTransitive((current) => !current)}
                  className="text-xs font-medium text-amber-300 transition hover:text-amber-200"
                >
                  {isLargeBlastRadius ? (showAllTransitive ? 'Collapse' : 'Expand') : null}
                </button>
              </div>
              <div className="space-y-2">
                {visibleTransitive.map((filePath) => (
                  <div key={filePath} className="rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2 font-mono text-xs text-amber-100">
                    {filePath}
                  </div>
                ))}
                {hiddenCount > 0 && (
                  <div className="rounded-xl border border-dashed border-gray-700 px-3 py-2 text-xs text-gray-400">
                    ...and {hiddenCount} more
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-2">
          <button
            onClick={handleCopyImpactList}
            className="rounded-xl border border-gray-700 bg-gray-950/80 px-4 py-3 text-sm font-medium text-gray-100 transition hover:border-gray-500 hover:bg-gray-900"
          >
            Copy impact list
          </button>
          <button
            onClick={handleExportJson}
            className="rounded-xl border border-gray-700 bg-gray-950/80 px-4 py-3 text-sm font-medium text-gray-100 transition hover:border-gray-500 hover:bg-gray-900"
          >
            Export as JSON
          </button>
          <button
            onClick={onClearImpactAnalysis}
            className="rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-gray-950 transition hover:bg-amber-400"
          >
            Clear
          </button>
        </div>
      </div>
    </aside>
  );
}

// ── US-047: Attack surface path finding ──────────────────────────────────────

function findAllPaths(sourceId, adjacency, sinkIds, maxPaths = 50, maxDepth = 20) {
  const paths = [];
  function dfs(current, currentPath, visited) {
    if (paths.length >= maxPaths) return;
    // Record path when a sink is reached (but keep exploring — the current node
    // may be a 'both' node that also has outgoing edges leading to further sinks).
    if (sinkIds.has(current) && current !== sourceId) {
      paths.push([...currentPath]);
      if (paths.length >= maxPaths) return;
    }
    // Prune depth AFTER recording so a node exactly at maxDepth can still be a sink.
    if (currentPath.length >= maxDepth) return;
    for (const neighbor of (adjacency.get(current) || [])) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        currentPath.push(neighbor);
        dfs(neighbor, currentPath, visited);
        currentPath.pop();
        visited.delete(neighbor);
      }
    }
  }
  const visited = new Set([sourceId]);
  dfs(sourceId, [sourceId], visited);
  return paths.sort((a, b) => a.length - b.length);
}

function PathCard({ path, index, nodeMap }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-2.5">
      <p className="text-xs text-gray-600 mb-1.5">Path {index + 1} · {path.length} {path.length === 1 ? 'hop' : 'hops'}</p>
      <div className="flex flex-col gap-0.5">
        {path.map((nodeId, i) => {
          const node = nodeMap.get(nodeId);
          const name = (node?.file_path || nodeId).split('/').pop();
          const isFirst = i === 0;
          const isLast  = i === path.length - 1;
          return (
            <div key={nodeId} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-gray-700 text-xs shrink-0">→</span>}
              <span
                className={`font-mono text-xs truncate ${isFirst ? 'text-red-300' : isLast ? 'text-orange-300' : 'text-yellow-200'}`}
                title={node?.file_path || nodeId}
              >
                {name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttackSurfacePanel({ graphNodes, sourceIds, sinkIds, bothIds, selectedSourceId, sourcePaths, perSourcePathCounts, onSelectSource, onClear }) {
  const [showAll, setShowAll] = useState(false);

  const nodeMap = useMemo(() => new Map(graphNodes.map(n => [n.graphId, n])), [graphNodes]);

  const allSourceCount = sourceIds.size + bothIds.size;
  const allSinkCount   = sinkIds.size  + bothIds.size;

  const sourceNodeList = useMemo(() =>
    graphNodes
      .filter(n => sourceIds.has(n.graphId) || bothIds.has(n.graphId))
      .sort((a, b) => (perSourcePathCounts.get(b.graphId) || 0) - (perSourcePathCounts.get(a.graphId) || 0)),
    [graphNodes, sourceIds, bothIds, perSourcePathCounts]
  );

  // Empty state — no sources or no sinks in this repo
  if (allSourceCount === 0 || allSinkCount === 0) {
    return (
      <aside className="w-full shrink-0 rounded-xl border border-surface-800 bg-surface-900/80 p-5 shadow-panel xl:w-80">
        <div className="flex h-full flex-col">
          <div className="mb-5">
            <p className="text-xs uppercase tracking-[0.2em] text-red-400/80">Attack Surface</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
            No externally reachable endpoints detected — or this repo is a library.
          </div>
          <button
            onClick={onClear}
            className="mt-auto rounded-xl border border-gray-700 bg-gray-950/80 px-4 py-3 text-sm font-medium text-gray-100 transition hover:border-gray-500 hover:bg-gray-900"
          >
            Close
          </button>
        </div>
      </aside>
    );
  }

  // Paths view — a specific source is selected
  if (selectedSourceId) {
    const selectedNode = nodeMap.get(selectedSourceId);
    const visiblePaths = showAll ? sourcePaths : sourcePaths.slice(0, 10);
    const hiddenCount  = sourcePaths.length - visiblePaths.length;
    return (
      <aside className="w-full shrink-0 rounded-xl border border-surface-800 bg-surface-900/80 p-5 shadow-panel transition-all duration-200 xl:w-80">
        <div className="flex h-full flex-col">
          <div className="mb-4">
            <p className="text-xs uppercase tracking-[0.2em] text-red-400/80">Attack Surface — Paths</p>
            <button
              onClick={() => { onSelectSource(null); setShowAll(false); }}
              className="mt-1 text-xs text-indigo-400 transition hover:text-indigo-200"
            >
              ← All sources
            </button>
            <h3 className="mt-2 break-all font-mono text-xs text-gray-300">{selectedNode?.file_path}</h3>
          </div>

          {sourcePaths.length === 0 ? (
            <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-4 text-sm text-gray-400">
              No paths from this source reach a detected sink.
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-gray-300">
                <span className="font-semibold text-red-300">{sourcePaths.length === 50 ? '50+' : sourcePaths.length}</span> path{sourcePaths.length !== 1 ? 's' : ''} reach a sink
              </p>
              <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
                {visiblePaths.map((path, i) => (
                  <PathCard key={i} path={path} index={i} nodeMap={nodeMap} />
                ))}
                {hiddenCount > 0 && !showAll && (
                  <button
                    onClick={() => setShowAll(true)}
                    className="w-full rounded-xl border border-dashed border-gray-700 px-3 py-2 text-xs text-gray-400 transition hover:text-gray-200"
                  >
                    ... {hiddenCount} more
                  </button>
                )}
              </div>
            </>
          )}

          <button
            onClick={onClear}
            className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-500/20"
          >
            Close attack surface
          </button>
        </div>
      </aside>
    );
  }

  // Sources list view
  return (
    <aside className="w-full shrink-0 rounded-xl border border-surface-800 bg-surface-900/80 p-5 shadow-panel transition-all duration-200 xl:w-80">
      <div className="flex h-full flex-col">
        <div className="mb-4">
          <p className="text-xs uppercase tracking-[0.2em] text-red-400/80">Attack Surface</p>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-red-200/70">Sources</p>
            <p className="mt-1 text-2xl font-semibold text-red-100">{allSourceCount}</p>
          </div>
          <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-orange-200/70">Sinks</p>
            <p className="mt-1 text-2xl font-semibold text-orange-100">{allSinkCount}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
          {sourceNodeList.map(node => {
            const pathCount = perSourcePathCounts.get(node.graphId) || 0;
            const isBoth = bothIds.has(node.graphId);
            return (
              <button
                key={node.graphId}
                onClick={() => onSelectSource(node.graphId)}
                className="w-full text-left rounded-xl border border-gray-800 bg-gray-950/70 px-3 py-3 transition hover:border-red-500/40 hover:bg-red-500/10"
              >
                <p className="font-mono text-xs text-red-100 break-all">{node.file_path}</p>
                <div className="mt-1 flex items-center gap-2">
                  {isBoth && <span className="rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-xs text-yellow-300">source + sink</span>}
                  <span className="text-xs text-gray-500">
                    {pathCount > 0
                      ? <span className="text-orange-300">{pathCount === 50 ? '50+' : pathCount} path{pathCount !== 1 ? 's' : ''} to sink</span>
                      : 'No sink reachable'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <button
          onClick={onClear}
          className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100 transition hover:bg-red-500/20"
        >
          Close attack surface
        </button>
      </div>
    </aside>
  );
}

/**
 * Compute directory clusters from flat file nodes.
 * Groups files sharing the same parent directory into a single cluster node.
 * Returns { clusterNodes, clusterEdges } ready for the simulation.
 */
function computeClusters(graphNodes, graphEdges, expandedClusters) {
  // Group nodes by directory path
  const dirMap = new Map(); // dirPath -> [node, ...]
  graphNodes.forEach((node) => {
    const parts = node.file_path.replace(/\\/g, '/').split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '(root)';
    if (!dirMap.has(dir)) dirMap.set(dir, []);
    dirMap.get(dir).push(node);
  });

  const clusterNodes = [];
  const nodeToCluster = new Map(); // graphId -> clusterId
  const expandedNodeIds = new Set();

  dirMap.forEach((dirNodes, dirPath) => {
    const isExpanded = expandedClusters.has(dirPath);

    if (isExpanded || dirNodes.length <= 2) {
      // Show individual nodes
      dirNodes.forEach((node) => {
        clusterNodes.push(node);
        if (isExpanded) expandedNodeIds.add(node.graphId);
      });
    } else {
      // Create cluster node
      const clusterId = `cluster:${dirPath}`;
      const totalIncoming = dirNodes.reduce((s, n) => s + (n.incoming_count || 0), 0);
      const totalOutgoing = dirNodes.reduce((s, n) => s + (n.outgoing_count || 0), 0);
      const avgComplexity = dirNodes.reduce((s, n) => s + (n.complexity_score || 0), 0) / dirNodes.length;
      const hasIssue = dirNodes.some((n) => n.hasIssue);

      // Use the most common language in the cluster for coloring
      const langCounts = {};
      dirNodes.forEach((n) => {
        const lang = n.language || 'unknown';
        langCounts[lang] = (langCounts[lang] || 0) + 1;
      });
      const dominantLang = Object.keys(langCounts).reduce((a, b) => (langCounts[a] >= langCounts[b] ? a : b), 'unknown');

      const clusterNode = {
        graphId: clusterId,
        file_path: dirPath,
        language: dominantLang,
        line_count: dirNodes.reduce((s, n) => s + (n.line_count || 0), 0),
        incoming_count: totalIncoming,
        outgoing_count: totalOutgoing,
        complexity_score: avgComplexity,
        radius: 18 + Math.min(20, Math.sqrt(dirNodes.length) * 6),
        fill: LANGUAGE_COLORS[dominantLang] || LANGUAGE_COLORS.unknown,
        hasIssue,
        isCluster: true,
        clusterDir: dirPath,
        childCount: dirNodes.length,
        childIds: dirNodes.map((n) => n.graphId),
      };

      clusterNodes.push(clusterNode);
      dirNodes.forEach((n) => nodeToCluster.set(n.graphId, clusterId));
    }
  });

  // Build cluster ID lookup for remaining individual nodes
  const clusterNodeIds = new Set(clusterNodes.map((n) => n.graphId));

  // Remap edges
  const edgeDedup = new Map();
  graphEdges.forEach((edge) => {
    const srcMapped = nodeToCluster.get(edge.source) || edge.source;
    const tgtMapped = nodeToCluster.get(edge.target) || edge.target;

    // Skip internal cluster edges
    if (srcMapped === tgtMapped) return;
    // Skip edges where either end doesn't exist in our node set
    if (!clusterNodeIds.has(srcMapped) || !clusterNodeIds.has(tgtMapped)) return;

    const key = `${srcMapped}->${tgtMapped}`;
    if (!edgeDedup.has(key)) {
      edgeDedup.set(key, {
        id: key,
        source: srcMapped,
        target: tgtMapped,
      });
    }
  });

  return {
    clusterNodes,
    clusterEdges: Array.from(edgeDedup.values()),
  };
}

export default function DependencyGraph({
  nodes,
  edges,
  issues,
  selectedNodeId,
  impactAnalysis,
  churnData = [],
  onNodeSelect,
  onAnalyseImpact,
  onClearImpactAnalysis,
  onChatWithFile,
  onAuditFile,
  repoName,
  repoSource,
}) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const canvasRef = useRef(null);
  const searchInputRef = useRef(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [clusteringEnabled, setClusteringEnabled] = useState(true);
  const [expandedClusters, setExpandedClusters] = useState(new Set());
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  // US-047: attack surface state
  const [attackSurfaceMode, setAttackSurfaceMode]   = useState(false);
  const [attackSurfaceSource, setAttackSurfaceSource] = useState(null); // graphId of selected source

  // US-050: hotspot mode
  const [hotspotGraphMode, setHotspotGraphMode] = useState(false);
  const [coverageGraphMode, setCoverageGraphMode] = useState(false);

  // Search state
  const [searchBarOpen, setSearchBarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchCurrent, setSearchCurrent] = useState(0);

  const exportFilename = repoName ? repoName.replace(/[^\w.-]/g, '_') : 'graph';
  const canShowHotspotControl = repoSource === 'github' || churnData.length > 0;
  const hasHotspotData = churnData.length > 0;

  // Ctrl+F / Cmd+F opens search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchBarOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (searchBarOpen) {
      const id = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [searchBarOpen]);

  const exportSVG = () => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportFilename}-graph.svg`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  };

  const exportPNG = async () => {
    setExportMenuOpen(false);
    let canvas;
    if (renderMode === 'canvas') {
      canvas = canvasRef.current;
      if (!canvas) return;
    } else {
      const svgEl = svgRef.current;
      if (!svgEl) return;
      const svgStr = new XMLSerializer().serializeToString(svgEl);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((resolve) => { img.onload = resolve; img.src = url; });
      canvas = document.createElement('canvas');
      canvas.width = svgEl.clientWidth * 2;
      canvas.height = svgEl.clientHeight * 2;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
    }
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${exportFilename}-graph.png`;
    a.click();
  };

  const issueNodePaths = useMemo(() => {
    const pathSet = new Set();
    issues.forEach((issue) => {
      (issue.file_paths || []).forEach((path) => pathSet.add(path));
    });
    return pathSet;
  }, [issues]);

  const graphNodes = useMemo(() => {
    const maxIncoming = Math.max(1, ...nodes.map((node) => node.incoming_count || 0));
    return nodes.map((node) => ({
      ...node,
      graphId: node.id || node.file_path,
      radius: 8 + (16 * Math.sqrt((node.incoming_count || 0) / maxIncoming)),
      fill: LANGUAGE_COLORS[node.language] || LANGUAGE_COLORS.unknown,
      hasIssue: issueNodePaths.has(node.file_path),
    }));
  }, [issueNodePaths, nodes]);

  const graphNodeByPath = useMemo(
    () => new Map(graphNodes.map((node) => [node.file_path, node])),
    [graphNodes]
  );

  const graphEdges = useMemo(() => {
    return edges.flatMap((edge) => {
      const sourceNode = graphNodeByPath.get(edge.from_path);
      const targetNode = graphNodeByPath.get(edge.to_path);

      if (!sourceNode || !targetNode) {
        return [];
      }

      return [{
        id: edge.id || `${sourceNode.graphId}->${targetNode.graphId}`,
        source: sourceNode.graphId,
        target: targetNode.graphId,
      }];
    });
  }, [edges, graphNodeByPath]);

  // Compute clustered data when clustering is enabled and there are many nodes
  const shouldCluster = clusteringEnabled && graphNodes.length > 300 && !coverageGraphMode;

  const clusteredData = useMemo(() => {
    if (!shouldCluster) return null;
    return computeClusters(graphNodes, graphEdges, expandedClusters);
  }, [graphNodes, graphEdges, expandedClusters, shouldCluster]);

  // Use clustered or raw data for the simulation
  const simNodes = clusteredData ? clusteredData.clusterNodes : graphNodes;
  const simEdges = clusteredData ? clusteredData.clusterEdges : graphEdges;

  const handleClusterClick = useCallback((node) => {
    if (!node.isCluster) return false;
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(node.clusterDir)) {
        next.delete(node.clusterDir);
      } else {
        next.add(node.clusterDir);
      }
      return next;
    });
    return true;
  }, []);

  const selectedIds = useMemo(() => {
    if (Array.isArray(selectedNodeId)) return selectedNodeId.filter(Boolean);
    return selectedNodeId ? [selectedNodeId] : [];
  }, [selectedNodeId]);

  const selection = useMemo(() => {
    if (selectedIds.length === 0) {
      return {
        isActive: false,
        primaryId: null,
        highlightedNodeIds: new Set(),
        highlightedEdgeIds: new Set(),
      };
    }

    if (Array.isArray(selectedNodeId)) {
      const highlightedNodeIds = new Set(selectedIds);
      const highlightedEdgeIds = new Set(
        simEdges
          .filter((edge) => highlightedNodeIds.has(edge.source) || highlightedNodeIds.has(edge.target))
          .map((edge) => edge.id)
      );

      return {
        isActive: true,
        primaryId: selectedIds[0] || null,
        highlightedNodeIds,
        highlightedEdgeIds,
      };
    }

    const primaryId = selectedIds[0];
    const highlightedNodeIds = new Set([primaryId]);
    const highlightedEdgeIds = new Set();

    simEdges.forEach((edge) => {
      if (edge.source === primaryId || edge.target === primaryId) {
        highlightedNodeIds.add(edge.source);
        highlightedNodeIds.add(edge.target);
        highlightedEdgeIds.add(edge.id);
      }
    });

    return {
      isActive: true,
      primaryId,
      highlightedNodeIds,
      highlightedEdgeIds,
    };
  }, [simEdges, selectedIds, selectedNodeId]);

  const selectedNode = useMemo(() => {
    const primaryId = selection.primaryId;
    if (!primaryId) return null;
    return simNodes.find((node) => node.graphId === primaryId) || null;
  }, [simNodes, selection.primaryId]);

  // US-047: attack surface — classify nodes and compute paths
  const { asSourceIds, asSinkIds, asBothIds } = useMemo(() => {
    const src = new Set(), snk = new Set(), both = new Set();
    graphNodes.forEach(n => {
      if (n.node_classification === 'source') src.add(n.graphId);
      else if (n.node_classification === 'sink') snk.add(n.graphId);
      else if (n.node_classification === 'both') both.add(n.graphId);
    });
    return { asSourceIds: src, asSinkIds: snk, asBothIds: both };
  }, [graphNodes]);

  // Adjacency for path finding (use raw graphEdges, not clustered)
  const asAdjacency = useMemo(() => {
    const adj = new Map();
    graphEdges.forEach(edge => {
      const src = typeof edge.source === 'object' ? edge.source.graphId : edge.source;
      const tgt = typeof edge.target === 'object' ? edge.target.graphId : edge.target;
      if (!adj.has(src)) adj.set(src, []);
      adj.get(src).push(tgt);
    });
    return adj;
  }, [graphEdges]);

  const allSinkIdsForPaths = useMemo(() => new Set([...asSinkIds, ...asBothIds]), [asSinkIds, asBothIds]);
  const allSourceIdsForPaths = useMemo(() => new Set([...asSourceIds, ...asBothIds]), [asSourceIds, asBothIds]);

  // Per-source path counts (computed once, used in panel list)
  const perSourcePathCounts = useMemo(() => {
    if (!attackSurfaceMode) return new Map();
    const counts = new Map();
    for (const sourceId of allSourceIdsForPaths) {
      counts.set(sourceId, findAllPaths(sourceId, asAdjacency, allSinkIdsForPaths, 50).length);
    }
    return counts;
  }, [attackSurfaceMode, allSourceIdsForPaths, asAdjacency, allSinkIdsForPaths]);

  // Paths from the currently-selected source (used for both panel display and highlighting)
  const currentSourcePaths = useMemo(() => {
    if (!attackSurfaceMode || !attackSurfaceSource) return [];
    return findAllPaths(attackSurfaceSource, asAdjacency, allSinkIdsForPaths, 50);
  }, [attackSurfaceMode, attackSurfaceSource, asAdjacency, allSinkIdsForPaths]);

  const attackSurfaceData = useMemo(() => {
    if (!attackSurfaceMode) return null;
    const pathNodeIds = new Set();
    const pathEdgeIds = new Set();
    if (attackSurfaceSource && currentSourcePaths.length > 0) {
      currentSourcePaths.forEach(path => {
        path.forEach(id => pathNodeIds.add(id));
        for (let i = 0; i < path.length - 1; i++) {
          pathEdgeIds.add(`${path[i]}->${path[i + 1]}`);
        }
      });
    }
    return { isActive: true, sourceIds: asSourceIds, sinkIds: asSinkIds, bothIds: asBothIds, pathNodeIds, pathEdgeIds };
  }, [attackSurfaceMode, asSourceIds, asSinkIds, asBothIds, attackSurfaceSource, currentSourcePaths]);

  // US-050: hotspot scores mapped to graphIds
  const hotspotModeData = useMemo(() => {
    if (!hotspotGraphMode || churnData.length === 0) return null;
    const pathToGraphId = new Map(graphNodes.map(n => [n.file_path, n.graphId]));
    const scores = new Map();
    for (const row of churnData) {
      const gid = pathToGraphId.get(row.file_path);
      if (gid != null) scores.set(gid, row.hotspot_score || 0);
    }
    return { isActive: true, scores };
  }, [hotspotGraphMode, churnData, graphNodes]);

  const coverageModeData = useMemo(() => {
    if (!coverageGraphMode) return null;
    return { isActive: true };
  }, [coverageGraphMode]);

  // Search: filter simNodes by file path query
  const searchMatchNodes = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return simNodes.filter((n) => !n.isCluster && n.file_path.toLowerCase().includes(q));
  }, [simNodes, searchQuery]);

  const searchCurrentNode = searchMatchNodes.length > 0
    ? searchMatchNodes[searchCurrent % searchMatchNodes.length]
    : null;

  // When searching, override the selection to highlight matched nodes
  const effectiveSelection = useMemo(() => {
    if (searchMatchNodes.length > 0) {
      const highlightedNodeIds = new Set(searchMatchNodes.map((n) => n.graphId));
      return {
        isActive: true,
        primaryId: searchCurrentNode?.graphId || null,
        highlightedNodeIds,
        highlightedEdgeIds: new Set(),
      };
    }
    return selection;
  }, [selection, searchMatchNodes, searchCurrentNode]);

  const renderMode = graphNodes.length > 300 ? 'canvas' : 'svg';

  useEffect(() => {
    if (!toastVisible) return undefined;
    const timeoutId = window.setTimeout(() => setToastVisible(false), 1400);
    return () => window.clearTimeout(timeoutId);
  }, [toastVisible]);

  useEffect(() => {
    if (!contextMenu && !exportMenuOpen) return undefined;

    const handleOutsideClick = () => {
      setContextMenu(null);
      setExportMenuOpen(false);
    };
    window.addEventListener('pointerdown', handleOutsideClick);

    return () => window.removeEventListener('pointerdown', handleOutsideClick);
  }, [contextMenu, exportMenuOpen]);

  const handleNodeClick = useCallback((node) => {
    if (node.isCluster && handleClusterClick(node)) return;
    onNodeSelect(node.graphId);
  }, [handleClusterClick, onNodeSelect]);

  const handleNodeContextMenu = useCallback((node, event) => {
    if (node.isCluster) return;
    setContextMenu({ node, x: event.clientX, y: event.clientY });
  }, []);

  const handleNodeDoubleClick = useCallback(async (node) => {
    if (node.isCluster) {
      handleClusterClick(node);
      return;
    }
    try {
      await navigator.clipboard.writeText(node.file_path);
      setToastVisible(true);
    } catch (error) {
      console.error('Failed to copy file path:', error);
    }
  }, [handleClusterClick]);

  const handleBackgroundClick = useCallback(() => {
    setContextMenu(null);
    onNodeSelect(null);
  }, [onNodeSelect]);

  const { resetView } = useGraphSimulation({
    containerRef,
    svgRef,
    canvasRef,
    nodes: simNodes,
    edges: simEdges,
    renderMode,
    selection: effectiveSelection,
    impactAnalysis,
    attackSurface: attackSurfaceData,
    hotspotMode: hotspotModeData,
    coverageMode: coverageModeData,
    focusNodeId: searchCurrentNode?.graphId || selection.primaryId,
    onNodeClick: handleNodeClick,
    onNodeContextMenu: handleNodeContextMenu,
    onNodeDoubleClick: handleNodeDoubleClick,
    onBackgroundClick: handleBackgroundClick,
  });

  const handleResetView = useCallback(() => {
    setContextMenu(null);
    setSearchQuery('');
    setSearchCurrent(0);
    setAttackSurfaceSource(null);
    setAttackSurfaceMode(false);
    setCoverageGraphMode(false);
    setHotspotGraphMode(false);
    onClearImpactAnalysis?.();
    onNodeSelect(null);
    resetView();
  }, [onClearImpactAnalysis, onNodeSelect, resetView]);

  if (graphNodes.length === 0) {
    return (
      <div className="flex h-auto min-h-[30rem] items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-900/40 px-6 text-center xl:h-[calc(100vh-12rem)]">
        <div>
          <p className="text-base text-gray-300">No graph data yet for this repository.</p>
          <p className="mt-2 text-sm text-gray-500">Re-index the repo once parsing finishes and the dependency map will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-auto min-h-[30rem] flex-col gap-4 xl:h-[calc(100vh-12rem)] xl:flex-row">
      <div className="relative min-h-[28rem] flex-1 overflow-hidden rounded-xl border border-surface-800 bg-[radial-gradient(circle_at_top,_rgba(79,140,255,0.10),_transparent_30%),linear-gradient(180deg,_rgba(9,10,15,0.98),_rgba(16,18,24,0.94))]">
        {/* Search bar */}
        {searchBarOpen && (
          <div className="absolute left-3 right-3 top-24 z-20 flex items-center gap-2 rounded-xl border border-gray-600 bg-gray-900/96 px-3 py-2 shadow-2xl shadow-black/60 backdrop-blur-sm sm:left-4 sm:right-auto sm:top-16">
            <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search files…"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchCurrent(0); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setSearchQuery(''); setSearchBarOpen(false); setSearchCurrent(0); }
                if (e.key === 'Enter') setSearchCurrent((c) => (c + 1) % Math.max(1, searchMatchNodes.length));
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-gray-500 sm:w-52"
            />
            {searchQuery && (
              <span className={`shrink-0 text-xs font-medium ${searchMatchNodes.length === 0 ? 'text-red-400' : 'text-gray-400'}`}>
                {searchMatchNodes.length === 0 ? 'No matches' : `${(searchCurrent % searchMatchNodes.length) + 1} / ${searchMatchNodes.length}`}
              </span>
            )}
            {searchMatchNodes.length > 1 && (
              <div className="flex gap-0.5">
                <button aria-label="Previous search match" onClick={() => setSearchCurrent((c) => (c - 1 + searchMatchNodes.length) % searchMatchNodes.length)} className="rounded px-1.5 py-0.5 text-gray-400 hover:bg-gray-700 hover:text-white transition text-xs"><ChevronUp className="h-3 w-3" /></button>
                <button aria-label="Next search match" onClick={() => setSearchCurrent((c) => (c + 1) % searchMatchNodes.length)} className="rounded px-1.5 py-0.5 text-gray-400 hover:bg-gray-700 hover:text-white transition text-xs"><ChevronDown className="h-3 w-3" /></button>
              </div>
            )}
            <button aria-label="Close graph search" onClick={() => { setSearchQuery(''); setSearchBarOpen(false); setSearchCurrent(0); }} className="ml-1 shrink-0 text-gray-500 transition hover:text-gray-200"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2 sm:left-4 sm:right-4 sm:top-4 sm:gap-3">
          {coverageGraphMode ? <CoverageLegend /> : <GraphLegend />}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="rounded-full border border-gray-700 bg-gray-950/80 px-3 py-1 text-xs uppercase tracking-[0.18em] text-gray-400">
              {renderMode === 'canvas' ? 'Canvas mode' : 'SVG mode'}
            </span>
            {graphNodes.length > 300 && (
              <button
                onClick={() => {
                  setClusteringEnabled((v) => !v);
                  setExpandedClusters(new Set());
                }}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  clusteringEnabled
                    ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25'
                    : 'border-gray-700 bg-gray-950/80 text-gray-400 hover:border-gray-500'
                }`}
              >
                {clusteringEnabled ? 'Clustered' : 'Flat'}
              </button>
            )}
            {shouldCluster && expandedClusters.size > 0 && (
              <button
                onClick={() => setExpandedClusters(new Set())}
                className="rounded-full border border-gray-700 bg-gray-950/80 px-3 py-1 text-xs font-medium text-gray-400 transition hover:border-gray-500 hover:text-gray-200"
              >
                Collapse all
              </button>
            )}
            <div className="relative">
              <button
                onClick={() => setExportMenuOpen((v) => !v)}
                className="rounded-full border border-gray-700 bg-gray-950/80 px-3 py-1 text-xs font-medium text-gray-400 transition hover:border-gray-500 hover:text-gray-200"
              >
                <Download className="mr-1.5 inline h-3.5 w-3.5" /> Export
              </button>
              {exportMenuOpen && (
                <div
                  className="absolute right-0 top-full z-30 mt-1 min-w-36 rounded-xl border border-gray-700 bg-gray-950/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={exportSVG}
                    disabled={renderMode === 'canvas'}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-100 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Export as SVG
                  </button>
                  <button
                    onClick={exportPNG}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-100 transition hover:bg-gray-800"
                  >
                    Export as PNG
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => setSearchBarOpen((v) => !v)}
              title="Search files (Ctrl+F)"
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${searchBarOpen ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300' : 'border-gray-700 bg-gray-950/80 text-gray-400 hover:border-gray-500 hover:text-gray-200'}`}
            >
              <Search className="mr-1.5 inline h-3.5 w-3.5" /> Search
            </button>
            <button
              onClick={() => {
                const next = !attackSurfaceMode;
                setAttackSurfaceMode(next);
                setAttackSurfaceSource(null);
                if (next) setCoverageGraphMode(false);
                // Clustering uses cluster-level edge IDs that are incompatible with
                // individual-node path IDs — force flat mode while attack surface is on.
                if (next) {
                  setClusteringEnabled(false);
                  setExpandedClusters(new Set());
                }
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                attackSurfaceMode
                  ? 'border-red-500/50 bg-red-500/15 text-red-300 hover:bg-red-500/25'
                  : 'border-gray-700 bg-gray-950/80 text-gray-400 hover:border-gray-500 hover:text-gray-200'
              }`}
              title="Toggle attack surface mapping (US-047)"
            >
              <Shield className="mr-1.5 inline h-3.5 w-3.5" /> Attack Surface
            </button>
            <button
              onClick={() => {
                const next = !coverageGraphMode;
                setCoverageGraphMode(next);
                if (next) {
                  setAttackSurfaceMode(false);
                  setAttackSurfaceSource(null);
                  setClusteringEnabled(false);
                  setExpandedClusters(new Set());
                }
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                coverageGraphMode
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
                  : 'border-gray-700 bg-gray-950/80 text-gray-400 hover:border-gray-500 hover:text-gray-200'
              }`}
              title="Toggle test coverage overlay"
            >
              <CirclePercent className="mr-1.5 inline h-3.5 w-3.5" /> Coverage
            </button>
            {canShowHotspotControl && (
              <button
                onClick={() => {
                  if (!hasHotspotData) return;
                  setHotspotGraphMode(v => !v);
                }}
                disabled={!hasHotspotData}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  !hasHotspotData
                    ? 'cursor-not-allowed border-gray-800 bg-gray-950/60 text-gray-600'
                    : hotspotGraphMode
                    ? 'border-orange-500/50 bg-orange-500/15 text-orange-300 hover:bg-orange-500/25'
                    : 'border-gray-700 bg-gray-950/80 text-gray-400 hover:border-gray-500 hover:text-gray-200'
                }`}
                title={hasHotspotData
                  ? 'Hotspots colour mode: green -> yellow -> red by churn x complexity'
                  : 'Hotspots data is still being computed from Git history'}
              >
                <TrendingUp className="mr-1.5 inline h-3.5 w-3.5" /> Hotspots
              </button>
            )}
            <button
              onClick={handleResetView}
              className="rounded-full border border-gray-700 bg-gray-950/80 px-4 py-2 text-sm font-medium text-gray-100 transition hover:border-gray-500 hover:bg-gray-900"
            >
              Reset view
            </button>
          </div>
        </div>
        {shouldCluster && (
          <div className="absolute bottom-4 left-4 z-10 rounded-full border border-gray-700 bg-gray-950/80 px-3 py-1.5 text-xs text-gray-400">
            {simNodes.length} clusters from {graphNodes.length} files · Click a cluster to expand
          </div>
        )}

        <div ref={containerRef} className="h-full w-full">
          <svg ref={svgRef} className={renderMode === 'svg' ? 'block h-full w-full' : 'hidden'} />
          <canvas ref={canvasRef} className={renderMode === 'canvas' ? 'block h-full w-full cursor-grab active:cursor-grabbing' : 'hidden'} />
        </div>

        <GraphToast message="File path copied to clipboard" visible={toastVisible} />

        {contextMenu && (
          <div
            className="fixed z-30 min-w-44 rounded-xl border border-gray-700 bg-gray-950/95 p-2 shadow-2xl shadow-black/50 backdrop-blur"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              onClick={() => {
                onNodeSelect(contextMenu.node.graphId);
                setContextMenu(null);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-100 transition hover:bg-gray-800"
            >
              View details
            </button>
            <button
              onClick={() => {
                onAnalyseImpact(contextMenu.node);
                setContextMenu(null);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-amber-200 transition hover:bg-gray-800"
            >
              Analyse impact
            </button>
            {attackSurfaceMode && (asSourceIds.has(contextMenu.node.graphId) || asBothIds.has(contextMenu.node.graphId)) && (
              <button
                onClick={() => {
                  setAttackSurfaceSource(contextMenu.node.graphId);
                  setContextMenu(null);
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-300 transition hover:bg-gray-800"
              >
                Show reachable paths
              </button>
            )}
            <button
              onClick={() => {
                onChatWithFile?.(contextMenu.node.file_path);
                setContextMenu(null);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-indigo-300 transition hover:bg-gray-800"
            >
              Chat with this file
            </button>
            <button
              onClick={() => {
                onAuditFile?.(contextMenu.node.file_path);
                setContextMenu(null);
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-red-200 transition hover:bg-gray-800"
            >
              Audit this file
            </button>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(contextMenu.node.file_path);
                  setToastVisible(true);
                } catch (error) {
                  console.error('Failed to copy file path:', error);
                } finally {
                  setContextMenu(null);
                }
              }}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-100 transition hover:bg-gray-800"
            >
              Copy path
            </button>
          </div>
        )}
      </div>

      {impactAnalysis ? (
        <ImpactAnalysisPanel impactAnalysis={impactAnalysis} onClearImpactAnalysis={onClearImpactAnalysis} />
      ) : attackSurfaceMode ? (
        <AttackSurfacePanel
          graphNodes={graphNodes}
          sourceIds={asSourceIds}
          sinkIds={asSinkIds}
          bothIds={asBothIds}
          selectedSourceId={attackSurfaceSource}
          sourcePaths={currentSourcePaths}
          perSourcePathCounts={perSourcePathCounts}
          onSelectSource={setAttackSurfaceSource}
          onClear={() => { setAttackSurfaceMode(false); setAttackSurfaceSource(null); }}
        />
      ) : (
        <GraphDetailsPanel node={selectedNode} onChatWithFile={onChatWithFile} onAuditFile={onAuditFile} />
      )}
    </div>
  );
}
