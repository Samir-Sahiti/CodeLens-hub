import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRepo } from '../context/RepoContext';
import { apiUrl } from '../lib/api';
import DependencyGraph from '../components/DependencyGraph';
import SearchPanel from '../components/SearchPanel';
import CodeReviewPanel from '../components/CodeReviewPanel';
import VirtualTable from '../components/VirtualTable';
import FileChatPanel from '../components/FileChatPanel';
import FileBrowser from '../components/FileBrowser';
import DependenciesPanel from '../components/DependenciesPanel';
import { useToast } from '../components/Toast';

function formatLanguage(str) {
  if (!str) return 'Unknown';
  if (str === 'javascript') return 'JavaScript';
  if (str === 'typescript') return 'TypeScript';
  if (str === 'python') return 'Python';
  if (str === 'c_sharp') return 'C#';
  if (str === 'go') return 'Go';
  if (str === 'java') return 'Java';
  if (str === 'rust') return 'Rust';
  if (str === 'ruby') return 'Ruby';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getFileBasename(filePath) {
  if (!filePath) return 'Unknown file';
  const normalizedPath = filePath.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  return parts[parts.length - 1] || filePath;
}

function formatDate(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

function buildImpactAnalysis(sourcePath, nodes, edges) {
  if (!sourcePath) return null;

  const nodeByPath = new Map(nodes.map((node) => [node.file_path, node]));
  const sourceNode = nodeByPath.get(sourcePath);
  if (!sourceNode) return null;

  const reverseAdjacency = new Map();
  edges.forEach((edge) => {
    if (!edge.from_path || !edge.to_path) return;
    if (!reverseAdjacency.has(edge.to_path)) {
      reverseAdjacency.set(edge.to_path, new Set());
    }
    reverseAdjacency.get(edge.to_path).add(edge.from_path);
  });

  const visited = new Set([sourcePath]);
  const queue = [{ path: sourcePath, depth: 0 }];
  const direct = [];
  const transitive = [];

  while (queue.length > 0) {
    const current = queue.shift();
    const dependents = reverseAdjacency.get(current.path) || new Set();

    dependents.forEach((dependentPath) => {
      if (visited.has(dependentPath)) return;
      visited.add(dependentPath);

      const nextDepth = current.depth + 1;
      if (nextDepth === 1) direct.push(dependentPath);
      else transitive.push(dependentPath);

      queue.push({ path: dependentPath, depth: nextDepth });
    });
  }

  const getGraphId = (path) => nodeByPath.get(path)?.id || path;

  return {
    sourceId: sourceNode.id || sourceNode.file_path,
    sourcePath: sourceNode.file_path,
    sourceName: getFileBasename(sourceNode.file_path),
    direct,
    transitive,
    directIds: direct.map(getGraphId),
    transitiveIds: transitive.map(getGraphId),
  };
}

// --- Child Panels ---
function MetricsPanel({ nodes, selectedNode, onNodeSelect, onAnalyseImpact }) {
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
  const p90Incoming   = calc90th(nodes, 'incoming_count');

  let criticalCount = 0;
  let atRiskCount   = 0;

  nodes.forEach(n => {
    const isHighComplex  = n.complexity_score > p90Complexity;
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
              const isHighComplex  = node.complexity_score > p90Complexity;
              const isHighIncoming = node.incoming_count > p90Incoming;
              const isSelected     = selectedNode && (selectedNode.id || selectedNode.file_path) === (node.id || node.file_path);

              let rowClass  = 'hover:bg-gray-800/60 cursor-pointer transition-colors';
              let textFade  = 'text-gray-300';
              let metaFade  = 'text-gray-500';

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
                  <td className={`px-6 py-3 font-medium ${textFade}`}>
                    {Number(node.complexity_score).toFixed(2)}
                  </td>
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

function IssuesPanel({ nodes, issues, onNodeSelect, onOpenDependencies }) {
  const nodeMap = useMemo(
    () => new Map(nodes.map(n => [n.file_path, n.id || n.file_path])),
    [nodes]
  );

  if (!issues || issues.length === 0) {
    return (
      <div className="flex h-[40rem] flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/30">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 mb-4">
          <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-200">No issues detected — your codebase looks healthy 🎉</h3>
      </div>
    );
  }

  const GROUP_ORDER = [
    { type: 'vulnerable_dependency', label: 'Vulnerable Dependencies', icon: '📦' },
    { type: 'hardcoded_secret',      label: 'Hardcoded Secrets',        icon: '🔒' },
    { type: 'insecure_pattern',      label: 'Insecure Code Patterns',   icon: '🛡️' },
    { type: 'circular_dependency',   label: 'Circular Dependencies',    icon: null },
    { type: 'god_file',              label: 'God Files',                icon: null },
    { type: 'high_coupling',         label: 'High Coupling',            icon: null },
    { type: 'dead_code',             label: 'Dead Code',                icon: null },
  ];

  const getBadgeStyles = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'high':   return 'bg-red-500/20 text-red-400 ring-1 ring-inset ring-red-500/30';
      case 'medium': return 'bg-orange-500/20 text-orange-400 ring-1 ring-inset ring-orange-500/30';
      case 'low':    return 'bg-yellow-500/20 text-yellow-400 ring-1 ring-inset ring-yellow-500/30';
      default:       return 'bg-gray-500/20 text-gray-400 ring-1 ring-inset ring-gray-500/30';
    }
  };

  const handleIssueClick = (issue) => {
    if (issue.type === 'vulnerable_dependency') {
      onOpenDependencies(issue);
      return;
    }

    const resolvedIds = issue.file_paths
      .map(p => nodeMap.get(p))
      .filter(Boolean);

    if (resolvedIds.length > 0) {
      onNodeSelect(resolvedIds);
    }
  };

  return (
    <div className="flex flex-col h-[40rem] overflow-auto bg-gray-950 rounded-xl space-y-8 p-1 relative">
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 text-sm text-gray-400">
        Issues is the triage view. It shows only actionable problems, including vulnerable dependencies. Click a dependency issue to jump into the `Dependencies` tab with that package pre-filtered.
      </div>
      {GROUP_ORDER.map(({ type, label, icon }) => {
        const groupIssues = issues.filter(i => i.type === type);
        if (groupIssues.length === 0) return null;

        return (
          <div key={type} className="mb-8 last:mb-0">
            <h2 className="text-lg font-semibold text-gray-200 border-b border-gray-800 pb-2 mb-4 sticky top-0 bg-gray-950 z-10 flex items-center">
              {icon && <span className="mr-2">{icon}</span>}
              {label} <span className="text-gray-500 text-sm ml-2 font-normal">({groupIssues.length})</span>
            </h2>
            <div className="grid gap-4">
              {groupIssues.map((issue, idx) => (
                <div
                  key={issue.id || `${type}-${idx}`}
                  onClick={() => handleIssueClick(issue)}
                  className="flex flex-col bg-gray-900/50 hover:bg-gray-800/80 border border-gray-800 hover:border-gray-700 rounded-lg p-5 cursor-pointer transition-all duration-200"
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wider ${getBadgeStyles(issue.severity)}`}>
                      {issue.severity || 'UNKNOWN'}
                    </span>
                  </div>
                  <p className="text-gray-300 text-sm mb-4 leading-relaxed">
                    {issue.description || 'No description available.'}
                  </p>
                  <div className="mt-auto bg-gray-950/50 rounded-md p-3 border border-gray-800 break-words">
                    <span className="font-mono text-xs text-gray-400 leading-loose">
                      {issue.file_paths.join(' → ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function SettingsPanel({ repo, session, onRepoUpdated }) {
  const [autoSync, setAutoSync] = useState(repo?.auto_sync_enabled ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState('');

  const isGitHub = repo?.source === 'github';

  const handleAutoSyncToggle = async () => {
    const next = !autoSync;
    setIsSaving(true);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repo.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ auto_sync_enabled: next }),
      });
      if (!res.ok) throw new Error('Failed to update setting');
      setAutoSync(next);
      onRepoUpdated();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateWebhook = async () => {
    setIsGenerating(true);
    setWebhookInfo(null);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repo.id}/webhook`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to generate webhook');
      const data = await res.json();
      setWebhookInfo(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      /* ignore */
    }
  };

  if (!isGitHub) {
    return (
      <div className="flex h-[40rem] flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/30">
        <p className="text-sm text-gray-500">Webhook auto-sync is only available for GitHub repositories.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Auto-sync toggle */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-white">Auto-sync on push</h3>
            <p className="mt-1 text-sm text-gray-400">
              Automatically re-index this repository whenever a push is made to the default branch via GitHub webhook.
            </p>
          </div>
          <button
            onClick={handleAutoSyncToggle}
            disabled={isSaving}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
              autoSync ? 'bg-indigo-600' : 'bg-gray-700'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                autoSync ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        {autoSync && (
          <p className="mt-3 text-xs text-indigo-400">
            Auto-sync is enabled. Make sure a webhook is configured in your GitHub repository settings below.
          </p>
        )}
      </div>

      {/* Webhook URL generation */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
        <h3 className="text-base font-semibold text-white">Webhook configuration</h3>
        <p className="mt-1 text-sm text-gray-400">
          Generate a webhook URL and secret to configure in your GitHub repository settings
          (Settings → Webhooks → Add webhook). Set the content type to{' '}
          <code className="rounded bg-gray-800 px-1 py-0.5 text-xs text-gray-200">application/json</code>{' '}
          and select the <strong className="text-gray-300">Push</strong> event only.
        </p>

        <button
          onClick={handleGenerateWebhook}
          disabled={isGenerating}
          className="mt-4 rounded-md bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition disabled:opacity-50"
        >
          {isGenerating ? 'Generating...' : 'Generate webhook URL'}
        </button>

        {webhookInfo && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
              Save the secret now — it will not be shown again. Generating a new one will invalidate the previous secret.
            </div>

            {[
              { label: 'Webhook URL', value: webhookInfo.webhookUrl, key: 'url' },
              { label: 'Secret',      value: webhookInfo.secret,     key: 'secret' },
            ].map(({ label, value, key }) => (
              <div key={key}>
                <p className="mb-1 text-xs uppercase tracking-widest text-gray-500">{label}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 overflow-auto rounded-md border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs text-gray-200 break-all">
                    {value}
                  </code>
                  <button
                    onClick={() => handleCopy(value, key)}
                    className="shrink-0 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-800 transition"
                  >
                    {copied === key ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function RepoView() {
  const { repoId } = useParams();
  const { session } = useAuth();
  const { setRepo: setRepoCtx, setIssueCount } = useRepo();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'graph';

  const [repo, setRepo]         = useState(null);

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [impactSourcePath, setImpactSourcePath] = useState(null);
  const [chatFilePath, setChatFilePath] = useState(null);

  const [analysisData, setAnalysisData]   = useState({ nodes: [], edges: [], issues: [] });
  const [hasFetchedData, setHasFetchedData] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  const [isLoading, setIsLoading]     = useState(true);
  const [error, setError]             = useState(null);
  const [isReindexing, setIsReindexing] = useState(false);

  const handleNodeSelect = useCallback((nodeIdOrIds, options = {}) => {
    setSelectedNodeId(nodeIdOrIds);
    if (options.openGraph) {
      setSearchParams({ tab: 'graph' }, { replace: true });
    }
  }, [setSearchParams]);

  const selectedNode = useMemo(() => {
    if (Array.isArray(selectedNodeId) || !selectedNodeId) return null;
    return analysisData.nodes.find((node) => (node.id || node.file_path) === selectedNodeId) || null;
  }, [analysisData.nodes, selectedNodeId]);

  const impactAnalysis = useMemo(
    () => buildImpactAnalysis(impactSourcePath, analysisData.nodes, analysisData.edges),
    [analysisData.edges, analysisData.nodes, impactSourcePath]
  );

  const handleStartImpactAnalysis = useCallback((nodeOrPath) => {
    const sourcePath = typeof nodeOrPath === 'string' ? nodeOrPath : nodeOrPath?.file_path;
    if (!sourcePath) return;

    const sourceNode = analysisData.nodes.find((node) => node.file_path === sourcePath);
    if (!sourceNode) return;

    setImpactSourcePath(sourcePath);
    setSelectedNodeId(sourceNode.id || sourceNode.file_path);
    setSearchParams({ tab: 'graph' }, { replace: true });
  }, [analysisData.nodes, setSearchParams]);

  const handleClearImpactAnalysis = useCallback(() => {
    setImpactSourcePath(null);
  }, []);

  const fetchAnalysisData = useCallback(async (force = false) => {
    if ((hasFetchedData && !force) || !session?.access_token) return;
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/analysis`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch analysis metadata');

      const data = await res.json();

      setAnalysisData({
        nodes:  data.nodes  || [],
        edges:  data.edges  || [],
        issues: data.issues || [],
      });
      setHasFetchedData(true);
      setAnalysisError(null);
    } catch (err) {
      console.error('Failed to fetch analysis datasets:', err);
      setAnalysisError(err.message || 'Failed to load analysis data');
    }
  }, [repoId, hasFetchedData, session?.access_token]);

  const fetchRepo = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(apiUrl('/api/repos'), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch repositories');

      const data = await res.json();
      const currentRepo = data.repos?.find(r => String(r.id) === repoId);

      if (!currentRepo) throw new Error('Repository not found');

      setRepo(currentRepo);

      if (currentRepo.status === 'ready') {
        fetchAnalysisData(true);
      }
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsLoading(false);
      setIsReindexing(false);
    }
  }, [session?.access_token, repoId, fetchAnalysisData]);

  useEffect(() => {
    fetchRepo();
  }, [fetchRepo]);

  useEffect(() => {
    if (repo?.status !== 'pending' && repo?.status !== 'indexing') return;
    const id = setInterval(fetchRepo, 3000);
    return () => clearInterval(id);
  }, [repo?.status, fetchRepo]);

  useEffect(() => {
    return () => {
      setAnalysisData({ nodes: [], edges: [], issues: [] });
      setRepoCtx(null);
      setIssueCount(0);
    };
  }, [setRepoCtx, setIssueCount]);

  // Sync repo and issue count into context so Layout's sidebar stays current
  useEffect(() => {
    setRepoCtx(repo);
  }, [repo, setRepoCtx]);

  useEffect(() => {
    setIssueCount(analysisData.issues.length);
  }, [analysisData.issues, setIssueCount]);

  // When a repo transitions from indexing → ready, land on Metrics for a better
  // "here's what we found" first impression rather than an empty graph.
  const prevStatusRef = useRef(null);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = repo?.status ?? null;
    if ((prev === 'pending' || prev === 'indexing') && repo?.status === 'ready') {
      setSearchParams((current) => {
        if (!current.get('tab')) {
          const next = new URLSearchParams(current);
          next.set('tab', 'metrics');
          return next;
        }
        return current;
      }, { replace: true });
    }
  }, [repo?.status, setSearchParams]);

  const handleReindex = async () => {
    if (!session?.access_token) return;
    setIsReindexing(true);
    setHasFetchedData(false);
    setImpactSourcePath(null);

    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/reindex`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to start re-indexing');

      await fetchRepo();
    } catch (err) {
      console.error(err);
      toast.error(err.message);
      setIsReindexing(false);
    }
  };

  const handleOpenDependencies = useCallback((issue) => {
    const packageName = issue?.description?.match(/:\s(@?[^@\s:]+(?:\/[^@\s:]+)?)@/)?.[1] || '';
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', 'dependencies');
      next.set('vulnerable', '1');
      if (packageName) next.set('dep', packageName);
      else next.delete('dep');
      if (issue?.description) next.set('dep_description', issue.description);
      else next.delete('dep_description');
      if (issue?.file_paths?.[0]) next.set('dep_manifest', issue.file_paths[0]);
      else next.delete('dep_manifest');
      if (issue?.severity) next.set('dep_severity', issue.severity);
      else next.delete('dep_severity');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  if (isLoading && !repo) {
    return (
      <div className="flex min-h-screen bg-gray-950 items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error || !repo) {
    return (
      <div className="min-h-screen bg-gray-950 p-8">
        <Link to="/dashboard" className="mb-6 inline-flex items-center text-sm font-medium text-gray-400 hover:text-white transition-colors">
          &larr; Dashboard
        </Link>
        <div className="rounded-md bg-red-900/50 p-4 border border-red-800 text-red-200 max-w-lg">
          {error || 'Repository not found'}
        </div>
      </div>
    );
  }

  const isWorking = repo.status === 'pending' || repo.status === 'indexing';

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-white">

      {/* Header Container */}
      <div className="border-b border-gray-800 bg-gray-900/50 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{repo.name}</h1>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                repo.status === 'ready'   ? 'bg-green-500/10 text-green-400 ring-1 ring-inset ring-green-500/20' :
                repo.status === 'failed'  ? 'bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/20' :
                isWorking                 ? 'bg-blue-500/10 text-blue-400 ring-1 ring-inset ring-blue-500/20 animate-pulse' :
                'bg-gray-500/10 text-gray-400 ring-1 ring-inset ring-gray-500/20'
              }`}>
                {repo.status === 'pending' ? 'Indexing' : repo.status.charAt(0).toUpperCase() + repo.status.slice(1)}
              </span>
            </div>
            <p className="text-sm text-gray-400 mt-1">
              {repo.source === 'github' ? 'GitHub' : 'Uploaded ZIP'} · {repo.file_count || 0} files
              {repo.indexed_at && ` · last indexed ${formatDate(repo.indexed_at)}`}
            </p>
          </div>

          <button
            onClick={handleReindex}
            disabled={isWorking || isReindexing}
            className="rounded-md bg-gray-800 px-4 py-2 text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isReindexing ? 'Starting...' : 'Re-index'}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-8 pb-12">
        {impactAnalysis && (
          <div className="mb-6 flex items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-amber-100">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-amber-300/80">Impact Analysis Active</p>
              <p className="mt-1 text-sm">
                <span className="font-semibold">{impactAnalysis.sourceName}</span> has {impactAnalysis.direct.length} direct and {impactAnalysis.transitive.length} transitive dependents highlighted.
              </p>
            </div>
            <button
              onClick={handleClearImpactAnalysis}
              className="rounded-full border border-amber-300/30 px-4 py-2 text-sm font-medium text-amber-50 transition hover:border-amber-200 hover:bg-amber-400/10"
            >
              Clear analysis
            </button>
          </div>
        )}

        {isWorking ? (
          <div className="flex flex-col items-center justify-center py-32 rounded-xl border border-dashed border-gray-800 bg-gray-900/30">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">Indexing Repository...</h3>
            <p className="text-gray-400 text-sm max-w-md text-center">
              We are currently parsing files, building the dependency graph, and extracting insights. This automatically refreshes every 5 seconds.
            </p>
          </div>
        ) : repo.status === 'failed' ? (
          <div className="flex flex-col items-center justify-center py-32 rounded-xl border border-dashed border-red-900/50 bg-red-950/10">
            <svg className="h-12 w-12 text-red-500 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-lg font-medium text-red-400 mb-2">Indexing Failed</h3>
            <p className="text-red-300 text-sm max-w-md text-center mb-6">
              Something went wrong while processing your repository. If you uploaded a zip, ensure it contains valid supported code files.
            </p>
            <button
              onClick={handleReindex}
              className="rounded-md bg-red-900/80 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 transition"
            >
              Retry Indexing
            </button>
          </div>
        ) : analysisError ? (
          <div className="rounded-md bg-red-900/50 p-4 border border-red-800 text-red-200">
            {analysisError}
          </div>
        ) : (
          <div className="h-full relative">
            <div className={activeTab === 'graph' ? 'block h-full' : 'hidden'}>
              <DependencyGraph
                nodes={analysisData.nodes}
                edges={analysisData.edges}
                issues={analysisData.issues}
                selectedNodeId={selectedNodeId}
                impactAnalysis={impactAnalysis}
                onNodeSelect={handleNodeSelect}
                onAnalyseImpact={handleStartImpactAnalysis}
                onClearImpactAnalysis={handleClearImpactAnalysis}
                onChatWithFile={(filePath) => setChatFilePath(filePath)}
                repoName={repo?.name}
              />
            </div>

            <div className={activeTab === 'metrics' ? 'block h-full' : 'hidden'}>
              <MetricsPanel
                nodes={analysisData.nodes}
                selectedNode={selectedNode}
                onNodeSelect={handleNodeSelect}
                onAnalyseImpact={handleStartImpactAnalysis}
              />
            </div>

            <div className={activeTab === 'issues' ? 'block h-full' : 'hidden'}>
              <IssuesPanel
                nodes={analysisData.nodes}
                issues={analysisData.issues}
                onNodeSelect={(nodeIds) => handleNodeSelect(nodeIds, { openGraph: true })}
                onOpenDependencies={handleOpenDependencies}
              />
            </div>

            <div className={activeTab === 'search' ? 'block h-full' : 'hidden'}>
              <SearchPanel repoId={repoId} />
            </div>

            {/* Review tab — CodeReviewPanel */}
            <div className={activeTab === 'review' ? 'block h-full' : 'hidden'}>
              <CodeReviewPanel repoId={repoId} />
            </div>

            {/* Settings tab — webhook / auto-sync */}
            <div className={activeTab === 'settings' ? 'block h-full' : 'hidden'}>
              <SettingsPanel
                repo={repo}
                session={session}
                onRepoUpdated={fetchRepo}
              />
            </div>

            {/* Files tab — repository file browser */}
            <div className={activeTab === 'files' ? 'block h-full' : 'hidden'}>
              <FileBrowser repoId={repoId} nodes={analysisData.nodes} />
            </div>

            {/* Dependencies tab — package vulnerability scanning (US-045) */}
            <div className={activeTab === 'dependencies' ? 'block h-full' : 'hidden'}>
              <DependenciesPanel repoId={repoId} />
            </div>
          </div>
        )}
      </div>

      {/* File chat panel — slides in from right, scoped to selected file */}
      <FileChatPanel
        repoId={repoId}
        filePath={chatFilePath}
        open={!!chatFilePath}
        onClose={() => setChatFilePath(null)}
      />
    </div>
  );
}
