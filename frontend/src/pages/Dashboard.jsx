import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ConnectGitHubModal from '../components/ConnectGitHubModal';
import UploadRepoModal from '../components/UploadRepoModal';

export default function Dashboard() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [repos, setRepos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const fetchRepos = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch('/api/repos', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch repositories');
      const data = await res.json();
      setRepos(data.repos || []);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [session?.access_token]);

  // Initial fetch and polling logic
  useEffect(() => {
    let timeoutId;

    const poll = async () => {
      await fetchRepos();
      
      // We need to check the exact same state that was just fetched to decide if we poll again.
      // Easiest is to rely on the next render's useEffect or inline check here.
      // We will do it in the effect dependency array below.
    };

    poll();

    return () => {
      clearTimeout(timeoutId);
    };
  }, [fetchRepos]);

  useEffect(() => {
    let timeoutId;
    const isWorking = repos.some(r => r.status === 'pending' || r.status === 'indexing');
    if (isWorking) {
      timeoutId = setTimeout(() => {
        fetchRepos();
      }, 5000);
    }
    return () => clearTimeout(timeoutId);
  }, [repos, fetchRepos]);

  const handleRetry = async (e, repoId) => {
    e.preventDefault(); // prevent link navigation
    e.stopPropagation();
    
    try {
      const res = await fetch(`/api/repos/${repoId}/reindex`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to restart indexing');
      
      // Fetch fresh so polling starts immediately
      await fetchRepos();
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  };

  const StatusBadge = ({ status }) => {
    switch (status) {
      case 'ready':
        return <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-1 text-xs font-medium text-green-400 ring-1 ring-inset ring-green-500/20">Ready</span>;
      case 'failed':
        return <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-1 text-xs font-medium text-red-400 ring-1 ring-inset ring-red-500/20">Failed</span>;
      case 'indexing':
        return <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-400 ring-1 ring-inset ring-blue-500/20 animate-pulse">Indexing</span>;
      default: // pending
        return <span className="inline-flex items-center rounded-full bg-gray-500/10 px-2 py-1 text-xs font-medium text-gray-400 ring-1 ring-inset ring-gray-500/20">Pending</span>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-8 text-white">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Your Repositories</h1>
        <div className="flex gap-4">
          <button
             onClick={() => setIsUploadModalOpen(true)}
             className="rounded-md bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 transition"
          >
            Upload Repository
          </button>
          <button
             onClick={() => setIsConnectModalOpen(true)}
             className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition shadow-sm"
          >
            Connect GitHub
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-red-900/50 p-4 border border-red-800 text-red-200">
          {error}
        </div>
      )}

      {repos.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-800 py-24">
          <svg className="mb-4 h-12 w-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="mb-1 text-lg font-medium text-gray-300">No repositories hooked up</h3>
          <p className="mb-6 text-sm text-gray-500">Connect a GitHub repo or upload a project to get started.</p>
          <div className="flex gap-4">
            <button onClick={() => setIsUploadModalOpen(true)} className="rounded-md bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 transition">Upload Project</button>
            <button onClick={() => setIsConnectModalOpen(true)} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition shadow-sm">Connect GitHub</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {repos.map(repo => (
            <Link
              key={repo.id}
              to={`/repo/${repo.id}`}
              className="group relative flex flex-col justify-between rounded-xl border border-gray-800 bg-gray-900 p-6 transition hover:border-gray-700 hover:bg-gray-800/80 hover:shadow-lg"
            >
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-100 group-hover:text-indigo-400 transition-colors">
                    {repo.name}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {repo.source === 'github' ? 'GitHub' : 'Upload'} • {repo.file_count || 0} files
                  </p>
                </div>
                <StatusBadge status={repo.status} />
              </div>

              <div className="flex items-center justify-between border-t border-gray-800/50 pt-4 mt-2">
                <span className="text-xs text-gray-500">
                  {repo.indexed_at 
                    ? `Indexed on ${new Date(repo.indexed_at).toLocaleDateString()}`
                    : `Added on ${new Date(repo.created_at).toLocaleDateString()}`}
                </span>
                
                {repo.status === 'failed' && (
                  <button
                    onClick={(e) => handleRetry(e, repo.id)}
                    className="rounded bg-red-900/40 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-800/60 transition"
                  >
                    Retry
                  </button>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <ConnectGitHubModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        existingRepos={repos}
        onConnected={fetchRepos}
      />

      <UploadRepoModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onConnected={fetchRepos}
      />
    </div>
  );
}
