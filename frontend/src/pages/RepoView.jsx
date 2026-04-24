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
import MetricsPanel from '../components/MetricsPanel';
import IssuesPanel from '../components/IssuesPanel';
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
      <div className="h-[calc(100vh-12rem)] min-h-[30rem] flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/30">
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
  const [depsRefreshKey, setDepsRefreshKey] = useState(0);

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

    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/reindex`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to start re-indexing');

      // Batch all resets + optimistic status change in one render so the UI
      // jumps straight to the "Indexing…" screen without flashing stale data
      setHasFetchedData(false);
      setAnalysisData({ nodes: [], edges: [], issues: [] });
      setDepsRefreshKey(k => k + 1);
      setImpactSourcePath(null);
      setRepo(prev => prev ? { ...prev, status: 'pending' } : prev);
    } catch (err) {
      toast.error(err.message);
    } finally {
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
      <div className="flex min-h-screen bg-[#0c0d14] p-8">
        <div className="flex-1 space-y-6">
          {/* Header skeleton */}
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-7 w-48 rounded-lg bg-gray-800 animate-pulse" />
              <div className="h-4 w-64 rounded bg-gray-800/60 animate-pulse" />
            </div>
            <div className="h-9 w-24 rounded-md bg-gray-800 animate-pulse" />
          </div>
          {/* Table skeleton */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
            <div className="border-b border-gray-800 bg-gray-800/95 px-6 py-4 flex gap-8">
              {[120,80,60,100,120,110].map((w,i) => <div key={i} className={`h-3 rounded bg-gray-700 animate-pulse`} style={{width: w}} />)}
            </div>
            {[...Array(8)].map((_,i) => (
              <div key={i} className="flex gap-8 px-6 py-3 border-b border-gray-800/40">
                {[200,70,50,60,80,80].map((w,j) => <div key={j} className="h-3 rounded bg-gray-800 animate-pulse" style={{width: w}} />)}
              </div>
            ))}
          </div>
        </div>
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
    <div className="flex flex-col min-h-screen bg-[#0c0d14] text-white">

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
        ) : !hasFetchedData ? (
          <div className="flex flex-col items-center justify-center py-32 rounded-xl border border-dashed border-gray-800 bg-gray-900/30">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mb-3" />
            <p className="text-sm text-gray-400">Loading analysis…</p>
          </div>
        ) : (
          <div className="h-full relative">
            <div className={activeTab === 'graph' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
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

            <div className={activeTab === 'metrics' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
              <MetricsPanel
                nodes={analysisData.nodes}
                selectedNode={selectedNode}
                onNodeSelect={handleNodeSelect}
                onAnalyseImpact={handleStartImpactAnalysis}
              />
            </div>

            <div className={activeTab === 'issues' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
              <IssuesPanel
                nodes={analysisData.nodes}
                issues={analysisData.issues}
                onNodeSelect={(nodeIds) => handleNodeSelect(nodeIds, { openGraph: true })}
                onOpenDependencies={handleOpenDependencies}
                repoId={repoId}
              />
            </div>

            <div className={activeTab === 'search' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
              <SearchPanel repoId={repoId} />
            </div>

            {/* Review tab — CodeReviewPanel */}
            <div className={activeTab === 'review' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
              <CodeReviewPanel repoId={repoId} />
            </div>

            {/* Settings tab — webhook / auto-sync */}
            <div className={activeTab === 'settings' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
              <SettingsPanel
                repo={repo}
                session={session}
                onRepoUpdated={fetchRepo}
              />
            </div>

            {/* Files tab — repository file browser */}
            <div className={activeTab === 'files' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
              <FileBrowser repoId={repoId} nodes={analysisData.nodes} />
            </div>

            {/* Dependencies tab — package vulnerability scanning (US-045) */}
            <div className={activeTab === 'dependencies' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
              <DependenciesPanel repoId={repoId} refreshKey={depsRefreshKey} />
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
