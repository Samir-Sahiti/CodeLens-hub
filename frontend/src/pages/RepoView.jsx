import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

// Helper component for tabs
const TabButton = ({ active, label, onClick, badge }) => (
  <button
    onClick={onClick}
    className={`
      flex items-center gap-2 whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium transition-colors
      ${active 
        ? 'border-indigo-500 text-indigo-400' 
        : 'border-transparent text-gray-400 hover:border-gray-700 hover:text-gray-200'
      }
    `}
  >
    {label}
    {badge !== undefined && badge > 0 && (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-indigo-500/20 text-indigo-300' : 'bg-gray-800 text-gray-300'
      }`}>
        {badge}
      </span>
    )}
  </button>
);

// --- Child Panels ---
function GraphPanel({ nodes, edges, issues }) {
  return (
    <div className="flex h-96 flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900/50">
      <p className="text-gray-400">Interactive D3.js Graph Panel (Coming Soon)</p>
      <p className="text-gray-600 text-sm mt-2">Loaded {nodes.length} nodes and {edges.length} edges directly from props.</p>
    </div>
  );
}

function MetricsPanel({ nodes, edges, issues }) {
  return (
    <div className="flex h-96 flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900/50">
      <p className="text-gray-400">Complexity Metrics Table Panel (Coming Soon)</p>
      <p className="text-gray-600 text-sm mt-2">Will analyze {nodes.length} files.</p>
    </div>
  );
}

function IssuesPanel({ nodes, edges, issues }) {
  return (
    <div className="flex h-96 flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900/50">
      <p className="text-gray-400">Architectural Issues Panel</p>
      <p className="text-indigo-400 text-sm mt-2 font-medium">{issues.length} flaws detected across the codebase.</p>
    </div>
  );
}

function SearchPanel({ nodes, edges, issues }) {
  return (
    <div className="flex h-96 flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900/50">
      <p className="text-gray-400">Natural Language Search Panel (Coming Soon)</p>
      <p className="text-gray-600 text-sm mt-2">RAG Architecture loading...</p>
    </div>
  );
}

export default function RepoView() {
  const { repoId } = useParams();
  const { session } = useAuth();
  
  const [repo, setRepo] = useState(null);
  const [activeTab, setActiveTab] = useState('graph');
  
  // Analysis Data state
  const [analysisData, setAnalysisData] = useState({ nodes: [], edges: [], issues: [] });
  const [hasFetchedData, setHasFetchedData] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isReindexing, setIsReindexing] = useState(false);

  // Fetch the huge datasets automatically when ready
  const fetchAnalysisData = useCallback(async () => {
    if (hasFetchedData) return;
    try {
      const [
        { data: nodes, error: nodesErr },
        { data: edges, error: edgesErr },
        { data: issues, error: issuesErr }
      ] = await Promise.all([
        supabase.from('graph_nodes').select('*').eq('repo_id', repoId),
        supabase.from('graph_edges').select('*').eq('repo_id', repoId),
        supabase.from('analysis_issues').select('*').eq('repo_id', repoId)
      ]);

      if (nodesErr) throw nodesErr;
      if (edgesErr) throw edgesErr;
      if (issuesErr) throw issuesErr;

      setAnalysisData({ 
        nodes: nodes || [], 
        edges: edges || [], 
        issues: issues || [] 
      });
      setHasFetchedData(true);
      setAnalysisError(null);
    } catch (err) {
      console.error('Failed to fetch analysis datasets:', err);
      setAnalysisError('Failed to load internal repository analysis data maps. Try refreshing the page.');
    }
  }, [repoId, hasFetchedData]);

  const fetchRepo = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch('/api/repos', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch repositories');
      
      const data = await res.json();
      const currentRepo = data.repos?.find(r => String(r.id) === repoId);
      
      if (!currentRepo) throw new Error('Repository not found');
      
      setRepo(currentRepo);
      
      // Load tables immediately if it's already ready
      if (currentRepo.status === 'ready') {
        fetchAnalysisData();
      }
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsLoading(false);
      setIsReindexing(false);
    }
  }, [session?.access_token, repoId, fetchAnalysisData]);

  // Initial fetch
  useEffect(() => {
    fetchRepo();
  }, [fetchRepo]);

  // Polling logic
  useEffect(() => {
    let timeoutId;
    if (repo?.status === 'pending' || repo?.status === 'indexing') {
      timeoutId = setTimeout(() => {
        fetchRepo();
      }, 5000);
    }
    return () => clearTimeout(timeoutId); // Clean up the polling timeout on unmount
  }, [repo?.status, fetchRepo]);

  const handleReindex = async () => {
    if (!session?.access_token) return;
    setIsReindexing(true);
    setHasFetchedData(false); // reset so it re-fetches exactly what changed
    
    try {
      const res = await fetch(`/api/repos/${repoId}/reindex`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to start re-indexing');
      
      await fetchRepo();
    } catch (err) {
      console.error(err);
      alert(err.message);
      setIsReindexing(false);
    }
  };

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

  // Treat pending as indexing for UI purposes, as uploadRepo controller sets status to pending initially
  const isWorking = repo.status === 'pending' || repo.status === 'indexing';

  return (
    <div className="flex flex-col min-h-screen bg-gray-950 text-white">
      
      {/* Header Container */}
      <div className="border-b border-gray-800 bg-gray-900/50 px-8 pt-6">
        <Link to="/dashboard" className="mb-4 inline-flex items-center text-sm font-medium text-gray-400 hover:text-white transition-colors">
          &larr; Dashboard
        </Link>
        
        <div className="flex items-center justify-between pb-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{repo.name}</h1>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                repo.status === 'ready' ? 'bg-green-500/10 text-green-400 ring-1 ring-inset ring-green-500/20' :
                repo.status === 'failed' ? 'bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/20' :
                isWorking ? 'bg-blue-500/10 text-blue-400 ring-1 ring-inset ring-blue-500/20 animate-pulse' :
                'bg-gray-500/10 text-gray-400 ring-1 ring-inset ring-gray-500/20'
              }`}>
                {repo.status === 'pending' ? 'Indexing' : repo.status.charAt(0).toUpperCase() + repo.status.slice(1)}
              </span>
            </div>
            <p className="text-sm text-gray-400 mt-1">
              {repo.source === 'github' ? 'GitHub' : 'Uploaded ZIP'} • {repo.file_count || 0} files indexed
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

        {/* Tab Bar Container */}
        {!isWorking && repo.status !== 'failed' && (
          <div className="mt-2 -mb-px flex gap-6">
            <TabButton active={activeTab === 'graph'} label="Graph" onClick={() => setActiveTab('graph')} />
            <TabButton active={activeTab === 'metrics'} label="Metrics" onClick={() => setActiveTab('metrics')} />
            <TabButton 
              active={activeTab === 'issues'} 
              label="Issues" 
              onClick={() => setActiveTab('issues')} 
              badge={analysisData.issues.length} 
            />
            <TabButton active={activeTab === 'search'} label="Search" onClick={() => setActiveTab('search')} />
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 p-8">
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
              <GraphPanel nodes={analysisData.nodes} edges={analysisData.edges} issues={analysisData.issues} />
            </div>

            <div className={activeTab === 'metrics' ? 'block h-full' : 'hidden'}>
              <MetricsPanel nodes={analysisData.nodes} edges={analysisData.edges} issues={analysisData.issues} />
            </div>

            <div className={activeTab === 'issues' ? 'block h-full' : 'hidden'}>
              <IssuesPanel nodes={analysisData.nodes} edges={analysisData.edges} issues={analysisData.issues} />
            </div>

            <div className={activeTab === 'search' ? 'block h-full' : 'hidden'}>
              <SearchPanel nodes={analysisData.nodes} edges={analysisData.edges} issues={analysisData.issues} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
