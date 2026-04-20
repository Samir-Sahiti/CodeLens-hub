import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Octokit } from 'octokit';
import { useToast } from './Toast';

export default function ConnectGitHubModal({ isOpen, onClose, existingRepos, onConnected }) {
  const toast = useToast();
  const [githubToken, setGithubToken] = useState(null);
  const [isTokenMissing, setIsTokenMissing] = useState(false);
  const [repos, setRepos] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(null);

  const observerTarget = useRef(null);

  // 1. Get GitHub token from the active session's provider_token.
  //    Supabase stores the OAuth provider token in the session — no DB read needed
  //    and the plaintext column no longer exists (migrated to Vault in US-039).
  useEffect(() => {
    if (!isOpen) return;
    
    const fetchToken = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const token = session.provider_token;
      if (!token) {
        setIsTokenMissing(true);
        setIsLoading(false);
      } else {
        setGithubToken(token);
      }
    };
    fetchToken();
  }, [isOpen]);

  // 2. Fetch repos from GitHub via Octokit when token / page changes
  useEffect(() => {
    if (!githubToken || !isOpen) return;

    const queryGitHub = async () => {
      setIsLoading(true);
      try {
        const octokit = new Octokit({ auth: githubToken });
        const res = await octokit.request('GET /user/repos', {
          sort: 'updated',
          per_page: 100,
          page: page,
        });

        if (res.data.length < 100) setHasMore(false);
        
        setRepos(prev => {
          // Prevent duplicates on strict mode dev re-renders
          const combined = [...prev, ...res.data];
          const unique = combined.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
          return unique;
        });
      } catch (err) {
        console.error(err);
        if (err.status === 401) setIsTokenMissing(true);
      } finally {
        setIsLoading(false);
      }
    };

    queryGitHub();
  }, [githubToken, page, isOpen]);

  // 3. Setup infinite scroll observer
  const handleObserver = useCallback(
    (entries) => {
      const [target] = entries;
      if (target.isIntersecting && hasMore && !isLoading) {
        setPage((prev) => prev + 1);
      }
    },
    [hasMore, isLoading]
  );

  useEffect(() => {
    const element = observerTarget.current;
    if (!element) return;

    const observer = new IntersectionObserver(handleObserver, { threshold: 1.0 });
    observer.observe(element);
    return () => observer.unobserve(element);
  }, [handleObserver]);

  // Handle repo connection
  const handleConnect = async (repo) => {
    setIsConnecting(repo.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/repos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: repo.full_name }),
      });

      if (!res.ok) throw new Error('Failed to connect repository');

      onConnected();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err.message);
    } finally {
      setIsConnecting(null);
    }
  };

  if (!isOpen) return null;

  // Filter repos client-side
  const filteredRepos = repos.filter(repo => 
    repo.full_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const existingRepoNames = new Set(existingRepos.map(r => r.name));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex w-full max-w-2xl flex-col rounded-xl bg-gray-900 border border-gray-800 shadow-2xl max-h-[85vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 p-6">
          <h2 className="text-xl font-semibold text-white">Connect GitHub Repository</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition">
            <svg fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {isTokenMissing ? (
          <div className="p-8 text-center flex flex-col items-center">
            <svg className="h-12 w-12 text-red-500 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="text-lg font-medium text-white mb-2">GitHub Token Invalid</h3>
            <p className="text-sm text-gray-400 mb-6 max-w-sm">We couldn't access your GitHub repositories. Your session might have expired or you haven't granted access.</p>
            <button
               onClick={() => supabase.auth.signInWithOAuth({ provider: 'github', options: { scopes: 'read:user repo' }})}
               className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 shadow-sm transition"
            >
              Re-authenticate with GitHub
            </button>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="p-4 border-b border-gray-800">
              <input
                type="text"
                placeholder="Search repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md bg-gray-950 border border-gray-800 px-4 py-2 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredRepos.map(repo => {
                const isAlreadyConnected = existingRepoNames.has(repo.full_name);
                
                return (
                  <div key={repo.id} className={`flex items-center justify-between rounded-lg border border-gray-800 p-4 ${isAlreadyConnected ? 'opacity-60 bg-gray-950' : 'bg-gray-800/50'}`}>
                    <div className="truncate pr-4">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-200 truncate">{repo.full_name}</span>
                        <span className="rounded-full border border-gray-700 bg-gray-800 px-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                          {repo.private ? 'Private' : 'Public'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        {repo.language && <span>{repo.language}</span>}
                        <span>Updated {new Date(repo.updated_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    
                    {isAlreadyConnected ? (
                      <span className="text-xs font-semibold text-gray-500 whitespace-nowrap">Already connected</span>
                    ) : (
                      <button
                        onClick={() => handleConnect(repo)}
                        disabled={isConnecting === repo.id}
                        className="rounded bg-indigo-600/10 px-4 py-1.5 text-xs font-semibold text-indigo-400 hover:bg-indigo-600/20 disabled:opacity-50 transition border border-indigo-500/20 whitespace-nowrap"
                      >
                        {isConnecting === repo.id ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>
                );
              })}
              
              {isLoading && (
                 <div className="py-4 text-center text-sm text-gray-500">Loading repositories...</div>
              )}
              
              {/* Invisible element for Infinite Scroll Intersection Observer */}
              <div ref={observerTarget} className="h-4 w-full" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
