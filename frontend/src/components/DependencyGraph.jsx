import { useEffect, useMemo, useRef, useState } from 'react';
import { useGraphSimulation } from '../hooks/useGraphSimulation';

const LANGUAGE_COLORS = {
  javascript: '#60a5fa',
  typescript: '#60a5fa',
  python: '#facc15',
  c_sharp: '#a78bfa',
  unknown: '#94a3b8',
};

function formatLanguage(language) {
  if (!language) return 'Unknown';
  if (language === 'javascript') return 'JavaScript';
  if (language === 'typescript') return 'TypeScript';
  if (language === 'python') return 'Python';
  if (language === 'c_sharp') return 'C#';
  return language.charAt(0).toUpperCase() + language.slice(1);
}

function GraphLegend() {
  const items = [
    { label: 'JS / TS', color: LANGUAGE_COLORS.javascript },
    { label: 'Python', color: LANGUAGE_COLORS.python },
    { label: 'C#', color: LANGUAGE_COLORS.c_sharp },
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

function GraphDetailsPanel({ node }) {
  return (
    <aside
      className={`w-72 shrink-0 rounded-2xl border border-gray-800 bg-gray-900/80 p-5 shadow-2xl shadow-black/20 transition-all duration-300 ${
        node ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-8 opacity-0 -mr-72'
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
    <aside className="w-80 shrink-0 rounded-2xl border border-gray-800 bg-gray-900/80 p-5 shadow-2xl shadow-black/20 transition-all duration-300">
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
          <div className="mt-5 space-y-4 overflow-y-auto pr-1">
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

export default function DependencyGraph({
  nodes,
  edges,
  issues,
  selectedNodeId,
  impactAnalysis,
  onNodeSelect,
  onAnalyseImpact,
  onClearImpactAnalysis,
}) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const canvasRef = useRef(null);
  const [toastVisible, setToastVisible] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);

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
        graphEdges
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

    graphEdges.forEach((edge) => {
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
  }, [graphEdges, selectedIds, selectedNodeId]);

  const selectedNode = useMemo(() => {
    const primaryId = selection.primaryId;
    if (!primaryId) return null;
    return graphNodes.find((node) => node.graphId === primaryId) || null;
  }, [graphNodes, selection.primaryId]);

  const renderMode = graphNodes.length > 300 ? 'canvas' : 'svg';

  useEffect(() => {
    if (!toastVisible) return undefined;
    const timeoutId = window.setTimeout(() => setToastVisible(false), 1400);
    return () => window.clearTimeout(timeoutId);
  }, [toastVisible]);

  useEffect(() => {
    if (!contextMenu) return undefined;

    const handleOutsideClick = () => setContextMenu(null);
    window.addEventListener('pointerdown', handleOutsideClick);

    return () => window.removeEventListener('pointerdown', handleOutsideClick);
  }, [contextMenu]);

  const { resetView } = useGraphSimulation({
    containerRef,
    svgRef,
    canvasRef,
    nodes: graphNodes,
    edges: graphEdges,
    renderMode,
    selection,
    impactAnalysis,
    focusNodeId: selection.primaryId,
    onNodeClick: (node) => onNodeSelect(node.graphId),
    onNodeContextMenu: (node, event) => {
      setContextMenu({
        node,
        x: event.clientX,
        y: event.clientY,
      });
    },
    onNodeDoubleClick: async (node) => {
      try {
        await navigator.clipboard.writeText(node.file_path);
        setToastVisible(true);
      } catch (error) {
        console.error('Failed to copy file path:', error);
      }
    },
    onBackgroundClick: () => {
      setContextMenu(null);
      onNodeSelect(null);
    },
  });


  if (graphNodes.length === 0) {
    return (
      <div className="flex h-[40rem] items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-900/40 text-center">
        <div>
          <p className="text-base text-gray-300">No graph data yet for this repository.</p>
          <p className="mt-2 text-sm text-gray-500">Re-index the repo once parsing finishes and the dependency map will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[40rem] gap-4">
      <div className="relative flex-1 overflow-hidden rounded-2xl border border-gray-800 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_30%),linear-gradient(180deg,_rgba(2,6,23,0.95),_rgba(15,23,42,0.92))]">
        <div className="absolute left-4 right-4 top-4 z-10 flex flex-wrap items-center justify-between gap-3">
          <GraphLegend />
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-gray-700 bg-gray-950/80 px-3 py-1 text-xs uppercase tracking-[0.18em] text-gray-400">
              {renderMode === 'canvas' ? 'Canvas mode' : 'SVG mode'}
            </span>
            <button
              onClick={resetView}
              className="rounded-full border border-gray-700 bg-gray-950/80 px-4 py-2 text-sm font-medium text-gray-100 transition hover:border-gray-500 hover:bg-gray-900"
            >
              Reset view
            </button>
          </div>
        </div>

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
      ) : (
        <GraphDetailsPanel node={selectedNode} />
      )}
    </div>
  );
}
