import { useEffect, useState, useCallback, useMemo, useRef, Suspense, lazy } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useAuth }          from '../context/AuthContext';
import { useRepo }          from '../context/RepoContext';
import { apiUrl }           from '../lib/api';
import { formatDate }       from '../lib/constants';
import { useToast }         from '../components/Toast';
import { Badge, Banner, Button, EmptyState, Panel, Skeleton } from '../components/ui/Primitives';
import { RefreshCw, ArrowLeft, Home, GitCompare } from '../components/ui/Icons';
import ArchDiffModal        from '../components/ArchDiffModal';

const DependencyGraph      = lazy(() => import('../components/DependencyGraph'));
const SearchPanel          = lazy(() => import('../components/SearchPanel'));
const CodeReviewPanel      = lazy(() => import('../components/CodeReviewPanel'));
const FileChatPanel        = lazy(() => import('../components/FileChatPanel'));
const FileBrowser          = lazy(() => import('../components/FileBrowser'));
const DependenciesPanel    = lazy(() => import('../components/DependenciesPanel'));
const MetricsPanel         = lazy(() => import('../components/MetricsPanel'));
const IssuesPanel          = lazy(() => import('../components/IssuesPanel'));
const SettingsPanel        = lazy(() => import('../components/SettingsPanel'));

const STAGE_COPY = {
  discovery: 'Scanning repository files...',
  hash: 'Checking what changed...',
  parse: 'Parsing code and dependencies...',
  graph_persist: 'Building the graph...',
  issue_detection: 'Finding architectural and security issues...',
  file_content_persist: 'Saving indexed source...',
  core_finalize: 'Finalizing core analysis...',
  sca: 'Scanning dependencies...',
  embeddings: 'Preparing semantic search...',
  queued: 'Queueing indexing work...',
  startup: 'Preparing indexing runtime...',
};

function getFileBasename(filePath) {
  if (!filePath) return 'Unknown file';
  const normalizedPath = filePath.replace(/\\/g, '/');
  const parts = normalizedPath.split('/');
  return parts[parts.length - 1] || filePath;
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

export default function RepoView() {
  const { repoId } = useParams();
  const { session } = useAuth();
  const { setRepo: setRepoCtx, setIssueCount } = useRepo();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'graph';

  const [repo, setRepo]         = useState(null);
  const [statusDetails, setStatusDetails] = useState(null);

  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [impactSourcePath, setImpactSourcePath] = useState(null);
  const [chatFilePath, setChatFilePath] = useState(null);
  const [reviewPrefill, setReviewPrefill] = useState(null);

  const [analysisData, setAnalysisData]   = useState({ nodes: [], edges: [], issues: [], hasCoverageFiles: false });
  const [hasFetchedData, setHasFetchedData] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [churnData, setChurnData] = useState([]);
  const [churnPollCount, setChurnPollCount] = useState(0);

  const [isLoading, setIsLoading]     = useState(true);
  const [error, setError]             = useState(null);
  const [isReindexing, setIsReindexing] = useState(false);
  const [depsRefreshKey, setDepsRefreshKey] = useState(0);
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);

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
      const [analysisRes, churnRes] = await Promise.all([
        fetch(apiUrl(`/api/repos/${repoId}/analysis`), {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        fetch(apiUrl(`/api/repos/${repoId}/churn`), {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);

      if (!analysisRes.ok) throw new Error('Failed to fetch analysis metadata');

      const data = await analysisRes.json();
      setAnalysisData({
        nodes:  data.nodes  || [],
        edges:  data.edges  || [],
        issues: data.issues || [],
        hasCoverageFiles: Boolean(data.hasCoverageFiles),
      });

      if (churnRes.ok) {
        const churnJson = await churnRes.json();
        setChurnData(churnJson.churn || []);
      }

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
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [session?.access_token, repoId]);

  const fetchRepoStatus = useCallback(async () => {
    if (!session?.access_token || !repoId) return;
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/status`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch repository status');

      const data = await res.json();
      setStatusDetails(data);
      setRepo((prev) => prev ? {
        ...prev,
        status: data.status ?? prev.status,
        file_count: data.file_count ?? prev.file_count,
        indexed_at: data.indexed_at ?? prev.indexed_at,
        sast_disabled_rules: data.sast_disabled_rules ?? prev.sast_disabled_rules,
      } : prev);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to fetch repository status');
    } finally {
      setIsReindexing(false);
    }
  }, [repoId, session?.access_token]);

  const fetchChurnData = useCallback(async () => {
    if (!session?.access_token || !repoId) return false;
    const res = await fetch(apiUrl(`/api/repos/${repoId}/churn`), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return false;

    const churnJson = await res.json();
    const churn = churnJson.churn || [];
    setChurnData(churn);
    return churn.length > 0;
  }, [repoId, session?.access_token]);

  useEffect(() => {
    fetchRepo();
    fetchRepoStatus();
  }, [fetchRepo, fetchRepoStatus]);

  useEffect(() => {
    const shouldPoll = repo?.status === 'pending'
      || repo?.status === 'indexing'
      || statusDetails?.latest_job?.enrichment_status === 'running';
    if (!shouldPoll) return;
    const id = setInterval(fetchRepoStatus, 1000);
    return () => clearInterval(id);
  }, [repo?.status, statusDetails?.latest_job?.enrichment_status, fetchRepoStatus]);

  useEffect(() => {
    if (!statusDetails?.latest_job?.core_ready && repo?.status !== 'ready') return;
    fetchAnalysisData(true);
  }, [statusDetails?.latest_job?.core_ready, repo?.status, fetchAnalysisData]);

  useEffect(() => {
    const shouldPollChurn = repo?.source === 'github'
      && repo?.status === 'ready'
      && churnData.length === 0
      && churnPollCount < 20;
    if (!shouldPollChurn) return undefined;

    const id = setTimeout(async () => {
      const foundChurn = await fetchChurnData();
      setChurnPollCount((count) => foundChurn ? count : count + 1);
    }, 3000);

    return () => clearTimeout(id);
  }, [churnData.length, churnPollCount, fetchChurnData, repo?.source, repo?.status]);

  useEffect(() => {
    return () => {
      setAnalysisData({ nodes: [], edges: [], issues: [], hasCoverageFiles: false });
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
      const data = await res.json();

      // Batch all resets + optimistic status change in one render so the UI
      // jumps straight to the "Indexing…" screen without flashing stale data
      setHasFetchedData(false);
      setAnalysisData({ nodes: [], edges: [], issues: [], hasCoverageFiles: false });
      setChurnData([]);
      setChurnPollCount(0);
      setDepsRefreshKey(k => k + 1);
      setImpactSourcePath(null);
      setRepo(prev => prev ? { ...prev, status: 'pending', file_count: 0, indexed_at: null } : prev);
      setStatusDetails((prev) => ({
        ...(prev || {}),
        status: 'pending',
        file_count: 0,
        indexed_at: null,
        is_working: true,
        latest_job: data.job || prev?.latest_job || null,
      }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsReindexing(false);
    }
  };

  const handleOpenFile = useCallback((filePath) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('tab', 'files');
      next.set('file', filePath);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleAuditFile = useCallback(async (filePath) => {
    if (!session?.access_token || !filePath) return;
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/file?path=${encodeURIComponent(filePath)}`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch file content');
      }
      const data = await res.json();
      setReviewPrefill({
        mode: 'security_audit',
        filePath,
        content: data.content || '',
        key: `${filePath}:${Date.now()}`,
      });
      setSearchParams({ tab: 'review' }, { replace: true });
    } catch (err) {
      toast.error(err.message || 'Failed to prepare security audit');
    }
  }, [repoId, session?.access_token, setSearchParams, toast]);

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
      <div className="flex min-h-screen p-4 sm:p-6 lg:p-8">
        <div className="flex-1 space-y-6">
          {/* Header skeleton */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
            <Skeleton className="h-9 w-24" />
          </div>
          {/* Table skeleton */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-hidden">
            <div className="flex gap-8 overflow-hidden border-b border-gray-800 bg-gray-800/95 px-6 py-4">
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
      <div className="min-h-screen p-4 sm:p-6 lg:p-8">
        <Link to="/dashboard" className="mb-6 inline-flex items-center text-sm font-medium text-gray-400 hover:text-white transition-colors">
          &larr; Dashboard
        </Link>
        <Banner tone="danger" className="max-w-lg">{error || 'Repository not found'}</Banner>
      </div>
    );
  }

  const isWorking = repo.status === 'pending' || repo.status === 'indexing';
  const currentStage = statusDetails?.latest_job?.current_stage || null;
  const stageCopy = STAGE_COPY[currentStage] || 'Indexing repository...';
  const progressPct = statusDetails?.latest_job?.progress_pct ?? 0;
  const isEnrichmentRunning = statusDetails?.latest_job?.enrichment_status === 'running';
  const canShowAnalysis = Boolean(statusDetails?.latest_job?.core_ready) || repo.status === 'ready';

  return (
    <div className="flex min-h-screen flex-col text-white">

      {/* Header Container */}
      <div className="border-b border-surface-800 bg-surface-900/92 px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-gray-600 mb-3">
          <Link to="/dashboard" className="flex items-center gap-1 hover:text-gray-400 transition-colors">
            <Home className="h-3 w-3" />
            Dashboard
          </Link>
          <span>/</span>
          <span className="text-gray-400 font-medium">{repo.name}</span>
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-white">{repo.name}</h1>
              <Badge tone={repo.status === 'ready' ? 'success' : repo.status === 'failed' ? 'danger' : isWorking ? 'accent' : 'subtle'}>
                {repo.status === 'pending' ? 'Indexing' : repo.status.charAt(0).toUpperCase() + repo.status.slice(1)}
              </Badge>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {repo.source === 'github' ? 'GitHub' : 'Uploaded ZIP'} · {repo.file_count || 0} files
              {repo.indexed_at && ` · indexed ${formatDate(repo.indexed_at)}`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {repo?.source === 'github' && (
              <Button
                onClick={() => setIsDiffModalOpen(true)}
                disabled={isWorking}
                icon={GitCompare}
                variant="outline"
              >
                Compare
              </Button>
            )}
            <Button
              onClick={handleReindex}
              disabled={isWorking || isReindexing}
              icon={RefreshCw}
              loading={isReindexing}
            >
              {isReindexing ? 'Starting...' : 'Re-index'}
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-4 pb-8 sm:p-6 sm:pb-10 lg:p-8 lg:pb-12">
        {canShowAnalysis && isEnrichmentRunning && (
          <Banner tone="accent" className="mb-6 flex-col sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-indigo-200/80">Repository Ready</p>
              <p className="mt-1 text-sm">
                Repository ready. Final enrichment still running{currentStage === 'sca' || currentStage === 'embeddings' ? `: ${STAGE_COPY[currentStage]}` : '.'}
              </p>
            </div>
            <div className="rounded-full border border-indigo-300/20 px-3 py-1 text-xs font-semibold text-indigo-100">
              {Math.max(progressPct, 85)}%
            </div>
          </Banner>
        )}

        {impactAnalysis && (
          <Banner tone="warning" className="mb-6 flex-col sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-amber-300/80">Impact Analysis Active</p>
              <p className="mt-1 text-sm">
                <span className="font-semibold">{impactAnalysis.sourceName}</span> has {impactAnalysis.direct.length} direct and {impactAnalysis.transitive.length} transitive dependents highlighted.
              </p>
            </div>
            <Button
              onClick={handleClearImpactAnalysis}
              variant="outline"
            >
              Clear analysis
            </Button>
          </Banner>
        )}

        {isWorking && !canShowAnalysis ? (
          <EmptyState
            title={stageCopy}
            description={`${stageCopy} This refreshes automatically while indexing continues.`}
            className="py-32"
            actions={(
              <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-surface-800">
                <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${Math.max(4, Math.min(progressPct, 100))}%` }} />
              </div>
            )}
          />
        ) : repo.status === 'failed' ? (
          <EmptyState
            title="Indexing failed"
            description="Something went wrong while processing this repository. Uploaded archives should contain supported code files."
            className="py-32 border-red-900/50 bg-red-950/10"
            actions={<Button variant="danger" onClick={handleReindex}>Retry Indexing</Button>}
          />
        ) : analysisError ? (
          <Banner tone="danger">{analysisError}</Banner>
        ) : !hasFetchedData && canShowAnalysis ? (
          <EmptyState title="Loading analysis" description="Preparing graph, metrics, issues, and repository context." className="py-32" />
        ) : (
          <Suspense fallback={
            <div className="flex flex-col items-center justify-center py-32 rounded-xl border border-dashed border-gray-800 bg-gray-900/30">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mb-3" />
              <p className="text-sm text-gray-400">Loading module…</p>
            </div>
          }>
            <div className="h-full relative">
              <div className={activeTab === 'graph' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
                <DependencyGraph
                  nodes={analysisData.nodes}
                  edges={analysisData.edges}
                  issues={analysisData.issues}
                  selectedNodeId={selectedNodeId}
                  impactAnalysis={impactAnalysis}
                  churnData={churnData}
                  onNodeSelect={handleNodeSelect}
                  onAnalyseImpact={handleStartImpactAnalysis}
                  onClearImpactAnalysis={handleClearImpactAnalysis}
                  onChatWithFile={(filePath) => setChatFilePath(filePath)}
                  onAuditFile={handleAuditFile}
                  repoName={repo?.name}
                  repoSource={repo?.source}
                />
              </div>

              <div className={activeTab === 'metrics' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
                <MetricsPanel
                  nodes={analysisData.nodes}
                  selectedNode={selectedNode}
                  onNodeSelect={handleNodeSelect}
                  onAnalyseImpact={handleStartImpactAnalysis}
                  onAuditFile={handleAuditFile}
                  churnData={churnData}
                  repoSource={repo?.source}
                  hasCoverageFiles={analysisData.hasCoverageFiles}
                />
              </div>

              <div className={activeTab === 'issues' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
                <IssuesPanel
                  nodes={analysisData.nodes}
                  issues={analysisData.issues}
                  onNodeSelect={(nodeIds) => handleNodeSelect(nodeIds, { openGraph: true })}
                  onOpenDependencies={handleOpenDependencies}
                  onOpenFile={handleOpenFile}
                  repoId={repoId}
                />
              </div>

              <div className={activeTab === 'search' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
                <SearchPanel repoId={repoId} />
              </div>

              {/* Review tab — CodeReviewPanel */}
              <div className={activeTab === 'review' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
                <CodeReviewPanel repoId={repoId} prefill={reviewPrefill} />
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
                <FileBrowser repoId={repoId} nodes={analysisData.nodes} onAuditFile={handleAuditFile} />
              </div>

              {/* Dependencies tab — package vulnerability scanning (US-045) */}
              <div className={activeTab === 'dependencies' ? 'tab-panel-active h-full' : 'tab-panel-hidden h-full'}>
                <DependenciesPanel repoId={repoId} refreshKey={depsRefreshKey} />
              </div>
            </div>
          </Suspense>
        )}
      </div>

      {/* File chat panel — slides in from right, scoped to selected file */}
      <Suspense fallback={null}>
        <FileChatPanel
          repoId={repoId}
          filePath={chatFilePath}
          open={!!chatFilePath}
          onClose={() => setChatFilePath(null)}
        />
      </Suspense>

      {/* Architectural diff modal (US-051) */}
      {isDiffModalOpen && (
        <ArchDiffModal
          repoId={repoId}
          defaultBranch={repo?.default_branch || 'main'}
          onClose={() => setIsDiffModalOpen(false)}
        />
      )}
    </div>
  );
}
