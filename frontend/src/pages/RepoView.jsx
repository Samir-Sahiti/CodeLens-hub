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
function GraphPanel({ nodes, edges, issues, selectedNodeId }) {
  return (
    <div className="flex h-[40rem] flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900/50">
      <p className="text-gray-400">Interactive D3.js Graph Panel (Coming Soon)</p>
      <p className="text-gray-600 text-sm mt-2">Loaded {nodes.length} nodes and {edges.length} edges directly from props.</p>
      {selectedNodeId && (
        <p className="text-indigo-400 text-sm mt-4 font-medium border border-indigo-500/30 bg-indigo-500/10 px-4 py-2 rounded-lg text-center">
          Event Received:<br/> Graph will auto-pan to highlight Node ID: <br/> <span className="font-mono text-xs">{selectedNodeId}</span>
        </p>
      )}
    </div>
  );
}

function MetricsPanel({ nodes, onNodeSelect }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'complexity_score', direction: 'desc' });

  // 1. Filter first
  const filteredNodes = nodes.filter(n => n.file_path.toLowerCase().includes(searchQuery.toLowerCase()));

  // 2. Then Sort
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
      return { key, direction: 'desc' }; // default starting sort is desc
    });
  };

  // 3. 90th Percentile Calculation (dynamically computed against FULL repo, not filtered active view)
  const calc90th = (arr, key) => {
    if (!arr || arr.length === 0) return 0;
    const sortedVals = arr.map(n => n[key] || 0).sort((a, b) => a - b);
    const index = Math.floor(0.9 * sortedVals.length);
    return sortedVals[Math.min(index, sortedVals.length - 1)] || 0;
  };

  const p90Complexity = calc90th(nodes, 'complexity_score');
  const p90Incoming = calc90th(nodes, 'incoming_count');

  // Summary counts across whole repo
  let criticalCount = 0;
  let atRiskCount = 0;

  nodes.forEach(n => {
    const isHighComplex = n.complexity_score > p90Complexity;
    const isHighIncoming = n.incoming_count > p90Incoming;
    if (isHighComplex && isHighIncoming) criticalCount++;
    else if (isHighComplex || isHighIncoming) atRiskCount++;
  });

  // UI Helpers
  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) return <span className="ml-2 text-gray-600 font-mono">↕</span>;
    return <span className="ml-2 text-indigo-400 font-mono">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
  };

  const formatLanguage = (str) => {
    if (!str) return 'Unknown';
    if (str === 'javascript') return 'JavaScript';
    if (str === 'typescript') return 'TypeScript';
    if (str === 'python') return 'Python';
    if (str === 'c_sharp') return 'C#';
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  return (
    <div className="flex flex-col h-[40rem] overflow-hidden bg-gray-900/30 border border-gray-800 rounded-xl relative">
      {/* Header & Meta Summary */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900/80">
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

      {/* Wrapping the table in an auto-scrolling container */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="sticky top-0 bg-gray-800/95 backdrop-blur text-gray-300 z-10 shadow-sm border-b border-gray-700">
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
                {/* // TODO: replace with cyclomatic complexity in Sprint 5 */}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {sortedNodes.map(node => {
              // Calculate Risk Level Dynamically
              const isHighComplex = node.complexity_score > p90Complexity;
              const isHighIncoming = node.incoming_count > p90Incoming;
              
              let rowClass = "hover:bg-gray-800/60 cursor-pointer transition-colors";
              let textFade = "text-gray-300";
              let metaFade = "text-gray-500";

              if (isHighComplex && isHighIncoming) {
                rowClass = "bg-red-900/30 hover:bg-red-900/50 cursor-pointer transition-colors";
                textFade = "text-red-100 font-medium";
                metaFade = "text-red-300";
              } else if (isHighComplex || isHighIncoming) {
                rowClass = "bg-yellow-900/20 hover:bg-yellow-900/40 cursor-pointer transition-colors";
                textFade = "text-yellow-100";
                metaFade = "text-yellow-300/80";
              }

              return (
                <tr key={node.id} onClick={() => onNodeSelect(node.id)} className={rowClass}>
                  <td className={`px-6 py-3 font-mono text-xs ${textFade}`}>{node.file_path}</td>
                  <td className={`px-6 py-3 ${metaFade}`}>{formatLanguage(node.language)}</td>
                  <td className={`px-6 py-3 ${metaFade}`}>{node.line_count}</td>
                  <td className={`px-6 py-3 ${metaFade}`}>{node.outgoing_count}</td>
                  <td className={`px-6 py-3 ${metaFade}`}>{node.incoming_count}</td>
                  <td className={`px-6 py-3 font-medium ${textFade}`}>
                    {Number(node.complexity_score).toFixed(2)}
                  </td>
                </tr>
              )
            })}

            {sortedNodes.length === 0 && (
              <tr>
                <td colSpan="6" className="text-center py-12 text-gray-500">
                  No files found matching "{searchQuery}"
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IssuesPanel({ nodes, edges, issues }) {
  return (
    <div className="flex h-[40rem] flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900/50">
      <p className="text-gray-400">Architectural Issues Panel</p>
      <p className="text-indigo-400 text-sm mt-2 font-medium">{issues.length} flaws detected across the codebase.</p>
    </div>
  );
}

function SearchPanel({ nodes, edges, issues }) {
  return (
    <div className="flex h-[40rem] flex-col items-center justify-center rounded-xl border border-gray-800 bg-gray-900/50">
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
  
  // Shared state uplifted to allow clicking a metrics row to highlight it in the tree
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  
  // Analysis Data state
  const [analysisData, setAnalysisData] = useState({ nodes: [], edges: [], issues: [] });
  const [hasFetchedData, setHasFetchedData] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isReindexing, setIsReindexing] = useState(false);

  // Tab jump handler
  const handleNodeSelect = useCallback((nodeId) => {
    setSelectedNodeId(nodeId);
    setActiveTab('graph');
  }, []);

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
      <div className="flex-1 p-8 pb-12">
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
              <GraphPanel nodes={analysisData.nodes} edges={analysisData.edges} issues={analysisData.issues} selectedNodeId={selectedNodeId} />
            </div>

            <div className={activeTab === 'metrics' ? 'block h-full' : 'hidden'}>
              <MetricsPanel nodes={analysisData.nodes} onNodeSelect={handleNodeSelect} />
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
