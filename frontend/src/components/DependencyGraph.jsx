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

export default function DependencyGraph({ nodes, edges, issues, selectedNodeId, onNodeSelect }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const canvasRef = useRef(null);
  const [toastVisible, setToastVisible] = useState(false);

  const issueNodePaths = useMemo(() => {
    const pathSet = new Set();
    issues.forEach((issue) => {
      (issue.file_paths || []).forEach((path) => pathSet.add(path));
    });
    return pathSet;
  }, [issues]);

  const nodeByPath = useMemo(
    () => new Map(nodes.map((node) => [node.file_path, node])),
    [nodes]
  );

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

  const { resetView } = useGraphSimulation({
    containerRef,
    svgRef,
    canvasRef,
    nodes: graphNodes,
    edges: graphEdges,
    renderMode,
    selection,
    focusNodeId: selection.primaryId,
    onNodeClick: (node) => onNodeSelect(node.graphId),
    onNodeDoubleClick: async (node) => {
      try {
        await navigator.clipboard.writeText(node.file_path);
        setToastVisible(true);
      } catch (error) {
        console.error('Failed to copy file path:', error);
      }
    },
    onBackgroundClick: () => onNodeSelect(null),
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
      </div>

      <GraphDetailsPanel node={selectedNode} />
    </div>
  );
}
