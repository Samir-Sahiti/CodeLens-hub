import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase }  from '../lib/supabase';
import { apiUrl }    from '../lib/api';
import { Octokit }   from 'octokit';
import { useToast }  from './Toast';
import Modal         from './ui/Modal';
import { Button, SearchInput, Skeleton } from './ui/Primitives';
import { Globe, Loader2, Lock, Star } from './ui/Icons';

export default function ConnectGitHubModal({ isOpen, onClose, existingRepos, onConnected }) {
  const toast             = useToast();
  const [githubToken,     setGithubToken]     = useState(null);
  const [isTokenMissing,  setIsTokenMissing]  = useState(false);
  const [repos,           setRepos]           = useState([]);
  const [searchQuery,     setSearchQuery]     = useState('');
  const [page,            setPage]            = useState(1);
  const [hasMore,         setHasMore]         = useState(true);
  const [isLoading,       setIsLoading]       = useState(true);
  const [isConnecting,    setIsConnecting]    = useState(null);

  const observerTarget = useRef(null);

  // Get GitHub token from active session
  useEffect(() => {
    if (!isOpen) return;
    const fetchToken = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const token = session.provider_token;
      if (!token) { setIsTokenMissing(true); setIsLoading(false); }
      else { setGithubToken(token); }
    };
    fetchToken();
  }, [isOpen]);

  // Fetch repos from GitHub
  useEffect(() => {
    if (!githubToken || !isOpen) return;
    const queryGitHub = async () => {
      setIsLoading(true);
      try {
        const octokit = new Octokit({ auth: githubToken });
        const res = await octokit.request('GET /user/repos', {
          sort: 'updated', per_page: 100, page,
        });
        if (res.data.length < 100) setHasMore(false);
        setRepos(prev => {
          const combined = [...prev, ...res.data];
          return combined.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
        });
      } catch (err) {
        if (err.status === 401) setIsTokenMissing(true);
      } finally {
        setIsLoading(false);
      }
    };
    queryGitHub();
  }, [githubToken, page, isOpen]);

  // Infinite scroll
  const handleObserver = useCallback((entries) => {
    const [target] = entries;
    if (target.isIntersecting && hasMore && !isLoading) setPage(p => p + 1);
  }, [hasMore, isLoading]);

  useEffect(() => {
    const element = observerTarget.current;
    if (!element) return;
    const observer = new IntersectionObserver(handleObserver, { threshold: 1.0 });
    observer.observe(element);
    return () => observer.unobserve(element);
  }, [handleObserver]);

  const handleConnect = async (repo) => {
    setIsConnecting(repo.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl('/api/repos'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ name: repo.full_name }),
      });
      if (!res.ok) throw new Error('Failed to connect repository');
      onConnected();
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsConnecting(null);
    }
  };

  const filteredRepos    = repos.filter(r => r.full_name.toLowerCase().includes(searchQuery.toLowerCase()));
  const existingRepoNames = new Set(existingRepos.map(r => r.name));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Connect GitHub Repository" maxWidth="max-w-2xl">
      {isTokenMissing ? (
        <div className="flex flex-col items-center p-5 text-center sm:p-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/20 mb-4">
            <Lock className="h-7 w-7 text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">GitHub Token Invalid</h3>
          <p className="text-sm text-gray-400 mb-6 max-w-sm leading-relaxed">
            We couldn't access your GitHub repositories. Your session might have expired or you haven't granted access.
          </p>
          <Button
            onClick={() => supabase.auth.signInWithOAuth({ provider: 'github', options: { scopes: 'read:user repo' } })}
          >
            Re-authenticate with GitHub
          </Button>
        </div>
      ) : (
        <div className="flex max-h-[70vh] flex-col">
          {/* Search */}
          <div className="border-b border-gray-800 px-4 py-3 sm:px-6">
            <SearchInput
              type="text"
              placeholder="Search repositories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Repo list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {/* Loading skeletons */}
            {isLoading && repos.length === 0 && (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between rounded-xl border border-gray-800 p-4">
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-7 w-20 rounded-lg" />
                  </div>
                ))}
              </div>
            )}

            {filteredRepos.map((repo, i) => {
              const isAlreadyConnected = existingRepoNames.has(repo.full_name);
              return (
                <div
                  key={repo.id}
                  className={`flex flex-col gap-3 rounded-xl border p-4 transition-all duration-150 sm:flex-row sm:items-center sm:justify-between ${
                    isAlreadyConnected
                      ? 'border-gray-800 bg-gray-950/50 opacity-60'
                      : 'border-gray-800 bg-gray-800/40 hover:border-gray-700 hover:bg-gray-800/70'
                  }`}
                  style={{ animation: `slideUp 200ms ease ${i * 30}ms both` }}
                >
                  <div className="min-w-0 sm:pr-4">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {/* Owner avatar */}
                      {repo.owner?.avatar_url && (
                        <img
                          src={repo.owner.avatar_url}
                          alt={repo.owner.login}
                          className="h-4 w-4 rounded-full"
                        />
                      )}
                      <span className="font-medium text-gray-200 truncate text-sm">{repo.full_name}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                        repo.private
                          ? 'border-orange-800/50 bg-orange-900/20 text-orange-400'
                          : 'border-gray-700 bg-gray-800 text-gray-400'
                      }`}>
                        {repo.private ? <Lock className="h-2.5 w-2.5" /> : <Globe className="h-2.5 w-2.5" />}
                        {repo.private ? 'Private' : 'Public'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      {repo.language && <span className="text-gray-400">{repo.language}</span>}
                      {repo.stargazers_count > 0 && (
                        <span className="flex items-center gap-1">
                          <Star className="h-3 w-3 text-yellow-600" />
                          {repo.stargazers_count.toLocaleString()}
                        </span>
                      )}
                      <span>Updated {new Date(repo.updated_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {isAlreadyConnected ? (
                    <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-gray-500">
                      Connected
                    </span>
                  ) : (
                    <Button
                      onClick={() => handleConnect(repo)}
                      disabled={isConnecting === repo.id}
                      variant="outline"
                      size="sm"
                      loading={isConnecting === repo.id}
                      className="w-full sm:w-auto"
                    >
                      {isConnecting === repo.id ? 'Connecting...' : 'Connect'}
                    </Button>
                  )}
                </div>
              );
            })}

            {isLoading && repos.length > 0 && (
              <div className="py-4 flex justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
              </div>
            )}

            <div ref={observerTarget} className="h-4 w-full" />
          </div>
        </div>
      )}
    </Modal>
  );
}
