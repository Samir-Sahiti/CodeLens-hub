import { useState } from 'react';
import VirtualTable from './VirtualTable';

function formatLanguage(str) {
  if (!str) return 'Unknown';
  if (str === 'javascript') return 'JavaScript';
  if (str === 'typescript') return 'TypeScript';
  if (str === 'python') return 'Python';
  if (str === 'c_sharp') return 'C#';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default function MetricsPanel({ nodes, selectedNode, onNodeSelect, onAnalyseImpact }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'complexity_score', direction: 'desc' });

  const filteredNodes = nodes.filter(n => n.file_path.toLowerCase().includes(searchQuery.toLowerCase()));

  const sortedNodes = [...filteredNodes].sort((a, b) => {
    const valA = a[sortConfig.key] || 0;
    const valB = b[sortConfig.key] || 0;

    if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'desc' };
    });
  };

  const calc90th = (arr, key) => {
    if (!arr || arr.length === 0) return 0;
    const sortedVals = arr.map(n => n[key] || 0).sort((a, b) => a - b);
    const index = Math.floor(0.9 * sortedVals.length);
    return sortedVals[Math.min(index, sortedVals.length - 1)] || 0;
  };

  const p90Complexity = calc90th(nodes, 'complexity_score');
  const p90Incoming = calc90th(nodes, 'incoming_count');

  let criticalCount = 0;
  let atRiskCount = 0;

  nodes.forEach(n => {
    const isHighComplex = n.complexity_score > p90Complexity;
    const isHighIncoming = n.incoming_count > p90Incoming;
    if (isHighComplex && isHighIncoming) criticalCount++;
    else if (isHighComplex || isHighIncoming) atRiskCount++;
  });

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) return <span className="ml-2 text-gray-600 font-mono">↕</span>;
    return <span className="ml-2 text-indigo-400 font-mono">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="flex h-[40rem] gap-4">
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30 relative">
        <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900/80 p-4">
          <p className="text-sm text-gray-400 font-medium">
            {nodes.length} files total &middot;
            <span className="text-red-400 ml-2">{criticalCount} critical</span> &middot;
            <span className="text-yellow-400 ml-2">{atRiskCount} at-risk</span>
          </p>
          <input
            type="text"
            placeholder="Search by file path..."
            className="bg-gray-950 border border-gray-700 text-sm text-white rounded-md px-3 py-1.5 focus:outline-none focus:border-indigo-500 w-72 transition-colors placeholder:text-gray-600"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-hidden">
          <VirtualTable
            rows={sortedNodes}
            rowHeight={44}
            bufferRows={20}
            containerHeight="100%"
            tableClassName="w-full text-left text-sm whitespace-nowrap"
            renderHeader={() => (
              <thead className="bg-gray-800/95 backdrop-blur text-gray-300 z-10 shadow-sm border-b border-gray-700">
                <tr>
                  <th className="px-6 py-4 font-semibold cursor-pointer hover:text-white transition-colors select-none group" onClick={() => handleSort('file_path')}>
                    File Path <SortIcon columnKey="file_path" />
                  </th>
                  <th className="px-6 py-4 font-semibold cursor-pointer hover:text-white transition-colors select-none group" onClick={() => handleSort('language')}>
                    Language <SortIcon columnKey="language" />
                  </th>
                  <th className="px-6 py-4 font-semibold cursor-pointer hover:text-white transition-colors select-none group" onClick={() => handleSort('line_count')}>
                    Lines <SortIcon columnKey="line_count" />
                  </th>
                  <th className="px-6 py-4 font-semibold cursor-pointer hover:text-white transition-colors select-none group" onClick={() => handleSort('outgoing_count')}>
                    Imports (Outgoing) <SortIcon columnKey="outgoing_count" />
                  </th>
                  <th className="px-6 py-4 font-semibold cursor-pointer hover:text-white transition-colors select-none group" onClick={() => handleSort('incoming_count')}>
                    Dependents (Incoming) <SortIcon columnKey="incoming_count" />
                  </th>
                  <th className="px-6 py-4 font-semibold cursor-pointer hover:text-white transition-colors select-none group" onClick={() => handleSort('complexity_score')}>
                    Complexity Score <SortIcon columnKey="complexity_score" />
                  </th>
                </tr>
              </thead>
            )}
            renderRow={(node) => {
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

              if (isSelected) {
                rowClass = `${rowClass} ring-1 ring-inset ring-sky-400/70 bg-sky-500/10`;
              }

              return (
                <tr key={node.id || node.file_path} onClick={() => onNodeSelect(node.id || node.file_path, { openGraph: true })} className={rowClass} style={{ height: 44 }}>
                  <td className={`px-6 py-3 font-mono text-xs ${textFade}`}>{node.file_path}</td>
                  <td className={`px-6 py-3 ${metaFade}`}>{formatLanguage(node.language)}</td>
                  <td className={`px-6 py-3 ${metaFade}`}>{node.line_count}</td>
                  <td className={`px-6 py-3 ${metaFade}`}>{node.outgoing_count}</td>
                  <td className={`px-6 py-3 ${metaFade}`}>{node.incoming_count}</td>
                  <td className={`px-6 py-3 font-medium ${textFade}`}>{Number(node.complexity_score).toFixed(2)}</td>
                </tr>
              );
            }}
          />
          {sortedNodes.length === 0 && (
            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">
              No files found matching &quot;{searchQuery}&quot;
            </div>
          )}
        </div>
      </div>

      <aside
        className={`w-72 shrink-0 rounded-2xl border border-gray-800 bg-gray-900/80 p-5 shadow-2xl shadow-black/20 transition-all duration-300 ${
          selectedNode ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-8 opacity-0 -mr-72'
        }`}
      >
        {selectedNode && (
          <div className="flex h-full flex-col">
            <div className="mb-5">
              <p className="text-xs uppercase tracking-[0.2em] text-gray-500">File Details</p>
              <h3 className="mt-2 break-all font-mono text-sm text-gray-100">{selectedNode.file_path}</h3>
            </div>

            <div className="space-y-3 text-sm">
              <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-3">
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
  );
}

