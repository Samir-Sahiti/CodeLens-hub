import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RepoView() {
  const { repoId } = useParams();
  const { session } = useAuth();
  
  const [repo, setRepo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isReindexing, setIsReindexing] = useState(false);

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
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsLoading(false);
      setIsReindexing(false);
    }
  }, [session?.access_token, repoId]);

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
    return () => clearTimeout(timeoutId);
  }, [repo?.status, fetchRepo]);

  const handleReindex = async () => {
    if (!session?.access_token) return;
    setIsReindexing(true);
    
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

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error || !repo) {
    return (
      <div className="p-8">
        <div className="rounded-md bg-red-900/50 p-4 border border-red-800 text-red-200">
          {error || 'Repository not found'}
        </div>
        <Link to="/dashboard" className="mt-4 inline-block text-indigo-400 hover:underline">
          &larr; Back to Dashboard
        </Link>
      </div>
    );
  }

  const isWorking = repo.status === 'pending' || repo.status === 'indexing';

  return (
    <div className="min-h-screen bg-gray-950 p-8 text-white">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between border-b border-gray-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{repo.name}</h1>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              repo.status === 'ready' ? 'bg-green-500/10 text-green-400 ring-1 ring-inset ring-green-500/20' :
              repo.status === 'failed' ? 'bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/20' :
              repo.status === 'indexing' ? 'bg-blue-500/10 text-blue-400 ring-1 ring-inset ring-blue-500/20 animate-pulse' :
              'bg-gray-500/10 text-gray-400 ring-1 ring-inset ring-gray-500/20'
            }`}>
              {repo.status.charAt(0).toUpperCase() + repo.status.slice(1)}
            </span>
          </div>
          <p className="text-sm text-gray-400 mt-2">
            {repo.source === 'github' ? 'GitHub' : 'Uploaded'} • {repo.file_count || 0} files indexed
          </p>
        </div>
        
        <button
          onClick={handleReindex}
          disabled={isWorking || isReindexing}
          className="rounded-md bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isReindexing ? 'Starting...' : 'Re-index'}
        </button>
      </div>

      {/* Main Content Area */}
      {isWorking ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed border-gray-800 bg-gray-900/30">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mb-4" />
          <h3 className="text-lg font-medium text-white mb-2">Analyzing Repository...</h3>
          <p className="text-gray-400 text-sm max-w-md text-center">
            We are currently building the dependency graph and extracting insights. This usually takes a few minutes depending on the size of the repository.
          </p>
        </div>
      ) : repo.status === 'failed' ? (
        <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed border-red-900/50 bg-red-950/10">
          <svg className="h-12 w-12 text-red-500 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h3 className="text-lg font-medium text-red-400 mb-2">Indexing Failed</h3>
          <p className="text-red-300 text-sm max-w-md text-center mb-6">
            Something went wrong while processing your repository. If you uploaded a zip, ensure it contains valid code files.
          </p>
          <button
            onClick={handleReindex}
            className="rounded-md bg-red-900/50 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-800/60 transition"
          >
            Try Again
          </button>
        </div>
      ) : (
        <div className="py-12 text-center">
          <p className="text-gray-500 mb-4">CodeLens analysis interface coming soon.</p>
        </div>
      )}
    </div>
  );
}
