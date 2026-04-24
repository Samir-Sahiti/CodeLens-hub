import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import ConnectGitHubModal from '../components/ConnectGitHubModal';
import UploadRepoModal from '../components/UploadRepoModal';
import CreateTeamModal from '../components/CreateTeamModal';
import { useToast } from '../components/Toast';

const LANGUAGE_COLORS = {
  javascript: '#60a5fa',
  typescript: '#60a5fa',
  python: '#facc15',
  c_sharp: '#a78bfa',
  go: '#06b6d4',
  java: '#f97316',
  rust: '#ea580c',
  ruby: '#ef4444',
  unknown: '#94a3b8',
};

function getHealthDot(repo) {
  // Red: failed. Amber: has issues / pending. Green: ready + no obvious problems.
  if (repo.status === 'failed') return { color: 'bg-red-500', label: 'Failed' };
  if (repo.status === 'indexing' || repo.status === 'pending') return { color: 'bg-amber-400 animate-pulse', label: 'Indexing' };
  return { color: 'bg-emerald-400', label: 'Healthy' };
}

function LanguageMiniBar({ languages }) {
  if (!languages || languages.length === 0) return null;
  const total = languages.reduce((s, l) => s + l.count, 0);
  if (total === 0) return null;
  return (
    <div className="flex h-1 w-full overflow-hidden rounded-full mb-4" title="Language distribution">
      {languages.map((l) => (
        <div
          key={l.language}
          style={{ width: `${(l.count / total) * 100}%`, backgroundColor: LANGUAGE_COLORS[l.language] || LANGUAGE_COLORS.unknown }}
          title={l.language}
        />
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  switch (status) {
    case 'ready':
      return <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-1 text-xs font-medium text-green-400 ring-1 ring-inset ring-green-500/20">Ready</span>;
    case 'failed':
      return <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-1 text-xs font-medium text-red-400 ring-1 ring-inset ring-red-500/20">Failed</span>;
    case 'indexing':
      return <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-400 ring-1 ring-inset ring-blue-500/20 animate-pulse">Indexing</span>;
    default:
      return <span className="inline-flex items-center rounded-full bg-gray-500/10 px-2 py-1 text-xs font-medium text-gray-400 ring-1 ring-inset ring-gray-500/20">Pending</span>;
  }
}

function RepoCard({ repo, onRetry, onDelete, isRetrying }) {
  const health = getHealthDot(repo);
  const languages = repo.languages || [];

  return (
    <Link
      key={repo.id}
      to={`/repo/${repo.id}`}
      className="group relative flex flex-col justify-between rounded-xl border border-gray-700 bg-gray-900 overflow-hidden transition-all duration-200 hover:border-gray-600 hover:bg-gray-800/80 hover:shadow-xl hover:shadow-indigo-500/5"
    >
      {/* Gradient top border */}
      <div className="h-0.5 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

      <div className="p-6">
        {/* Language mini-bar */}
        <LanguageMiniBar languages={languages} />

        <div className="mb-4 flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${health.color}`} title={health.label} />
              <h2 className="text-xl font-semibold text-gray-100 group-hover:text-indigo-400 transition-colors truncate">
                {repo.name}
              </h2>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {repo.source === 'github' ? 'GitHub' : 'Upload'} • {repo.file_count || 0} files
              {repo.shared && repo.team_name && (
                <span className="ml-2 inline-flex items-center rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-400 ring-1 ring-inset ring-violet-500/20">
                  {repo.team_name}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 ml-3 shrink-0">
            <StatusBadge status={repo.status} />
            {repo.auto_sync_enabled && (
              <span className="inline-flex items-center rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-400 ring-1 ring-inset ring-indigo-500/20">
                Auto-sync
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-gray-800/50 pt-4 mt-2">
          <span className="text-xs text-gray-500">
            {repo.indexed_at
              ? `Indexed ${new Date(repo.indexed_at).toLocaleDateString()}`
              : `Added ${new Date(repo.created_at).toLocaleDateString()}`}
          </span>

          <div className="flex gap-2">
            {repo.status !== 'ready' && !repo.shared && (
              <button
                onClick={(e) => onRetry(e, repo.id)}
                disabled={isRetrying}
                className="rounded bg-red-900/40 px-3 py-1 text-xs font-semibold text-red-300 hover:bg-red-800/60 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRetrying ? 'Starting…' : 'Retry'}
              </button>
            )}
            {!repo.shared && (
              <button
                onClick={(e) => onDelete(e, repo.id)}
                className="rounded bg-gray-800/40 px-3 py-1 text-xs font-semibold text-gray-400 hover:bg-red-900/40 hover:text-red-300 transition"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [repos, setRepos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [teamCreatedMsg, setTeamCreatedMsg] = useState(null);
  const [retryingIds, setRetryingIds] = useState(() => new Set());

  const fetchRepos = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(apiUrl('/api/repos'), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch repositories');
      const data = await res.json();
      setRepos(data.repos || []);
    } catch (err) {
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
    const isWorking = repos.some(r => r.status === 'pending' || r.status === 'indexing');
    if (!isWorking) return;
    const id = setInterval(fetchRepos, 3000);
    return () => clearInterval(id);
  }, [repos.map(r => r.status).join(','), fetchRepos]);

  const handleRetry = async (e, repoId) => {
    e.preventDefault(); // prevent link navigation
    e.stopPropagation();

    if (retryingIds.has(repoId)) return;
    setRetryingIds(prev => new Set(prev).add(repoId));

    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/reindex`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to restart indexing');
      }

      // Fetch fresh so polling starts immediately
      await fetchRepos();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRetryingIds(prev => {
        const next = new Set(prev);
        next.delete(repoId);
        return next;
      });
    }
  };

  const handleDelete = async (e, repoId) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!window.confirm('Are you sure you want to delete this repository? This cannot be undone.')) {
      return;
    }
    
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to delete repository');
      
      await fetchRepos();
      toast.success('Repository deleted successfully');
    } catch (err) {
      console.error(err);
      toast.error(err.message);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0c0d14] p-8 text-white">
        <div className="mb-8 flex items-center justify-between">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-800" />
          <div className="flex gap-3">
            <div className="h-9 w-28 animate-pulse rounded-md bg-gray-800" />
            <div className="h-9 w-36 animate-pulse rounded-md bg-gray-800" />
            <div className="h-9 w-36 animate-pulse rounded-md bg-gray-700" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-800 bg-gray-900 overflow-hidden">
              <div className="h-0.5 w-full bg-gradient-to-r from-gray-700 via-gray-600 to-gray-700 animate-pulse" />
              <div className="p-6 space-y-4">
                <div className="h-1.5 w-full rounded-full bg-gray-800 animate-pulse" />
                <div className="flex justify-between">
                  <div className="space-y-2">
                    <div className="h-5 w-40 rounded bg-gray-700 animate-pulse" />
                    <div className="h-3 w-28 rounded bg-gray-800 animate-pulse" />
                  </div>
                  <div className="h-6 w-16 rounded-full bg-gray-800 animate-pulse" />
                </div>
                <div className="border-t border-gray-800/50 pt-4 flex justify-between">
                  <div className="h-3 w-32 rounded bg-gray-800 animate-pulse" />
                  <div className="h-6 w-16 rounded bg-gray-800 animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0c0d14] p-8 text-white">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Your Repositories</h1>
        <div className="flex gap-3">
          <button
            onClick={() => setIsCreateTeamOpen(true)}
            className="rounded-md border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition"
          >
            Create Team
          </button>
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

      {teamCreatedMsg && (
        <div className="mb-6 rounded-lg border border-green-800 bg-green-900/30 px-5 py-3 text-sm text-green-300">
          {teamCreatedMsg}
        </div>
      )}

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
        <>
          {/* Own repos */}
          {(() => {
            const ownedRepos = repos.filter(r => !r.shared);
            const sharedRepos = repos.filter(r => r.shared);
            return (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {ownedRepos.map(repo => (
                    <RepoCard key={repo.id} repo={repo} onRetry={handleRetry} onDelete={handleDelete} isRetrying={retryingIds.has(repo.id)} />
                  ))}
                </div>

                {sharedRepos.length > 0 && (
                  <div className="mt-10">
                    <h2 className="mb-4 text-lg font-semibold text-gray-300">Team Repositories</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {sharedRepos.map(repo => (
                        <RepoCard key={repo.id} repo={repo} onRetry={handleRetry} onDelete={handleDelete} isRetrying={retryingIds.has(repo.id)} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </>
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

      <CreateTeamModal
        isOpen={isCreateTeamOpen}
        onClose={() => setIsCreateTeamOpen(false)}
        onCreated={(team, count) => {
          fetchRepos();
          setTeamCreatedMsg(
            `Team "${team.name}" created with ${count} collaborator${count !== 1 ? 's' : ''} added. They will see the shared repository when they sign in.`
          );
          setTimeout(() => setTeamCreatedMsg(null), 8000);
        }}
      />
    </div>
  );
}
