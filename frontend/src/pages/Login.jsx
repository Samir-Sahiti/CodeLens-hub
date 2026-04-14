import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { session } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Redirect to dashboard if already logged in
  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleGitHubLogin = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: window.location.origin + '/auth/callback',
          scopes: 'repo', // Request repository permissions
        },
      });
      if (error) throw error;
      // Note: The UI doesn't necessarily update past this point if the OAuth redirect fires successfully
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-300 font-['DM_Sans',sans-serif] selection:bg-indigo-500/30 overflow-x-hidden relative">
      {/* Subtle Dot Pattern Background */}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-30 mix-blend-screen pointer-events-none"></div>

      {/* Navbar */}
      <nav className="relative z-10 border-b border-slate-800/50 bg-[#0a0f1e]/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="h-6 w-6 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
              </svg>
              <span className="font-['DM_Mono',monospace] text-lg font-bold text-white tracking-tight">CodeLens</span>
            </div>
            <div>
              <button
                onClick={handleGitHubLogin}
                disabled={isLoading}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-transparent px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Sign in with GitHub
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 pt-24 pb-16 sm:pt-32 sm:pb-24 lg:pb-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          
          {error && (
             <div className="mb-8 inline-block max-w-md w-full rounded-md bg-red-900/40 border border-red-800/50 p-4 text-sm text-red-200">
               {error}
             </div>
          )}

          <h1 className="mx-auto max-w-4xl font-['DM_Mono',monospace] text-4xl font-normal tracking-tight text-white sm:text-6xl lg:text-7xl leading-[1.1]">
            Understand any codebase. <br className="hidden sm:block" />
            <span className="text-slate-400 font-light">Instantly.</span>
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-slate-400">
            CodeLens indexes your repository and gives you an interactive dependency graph, architectural issue detection, and natural language search — so you spend less time reading files and more time building.
          </p>
          
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={handleGitHubLogin}
              disabled={isLoading}
              className="group inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-md bg-white px-6 py-3 text-sm font-medium text-slate-900 shadow-sm transition-all hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-800 border-t-transparent" />
              ) : (
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
                </svg>
              )}
              {isLoading ? 'Connecting...' : 'Sign in with GitHub'}
            </button>
            <a
              href="https://github.com/Samir-Sahiti/CodeLens-hub"
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-md border border-slate-700 bg-transparent px-6 py-3 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </main>

      {/* Feature Grid */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

          {/* Feature 1 — Dependency Graph */}
          <div className="rounded-xl border border-slate-800 bg-[#0d1326] p-8 transition-colors hover:border-slate-700">
            <svg className="mb-5 h-8 w-8 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" />
            </svg>
            <h3 className="font-['DM_Mono',monospace] text-xl font-medium text-white mb-2">Dependency Graph</h3>
            <p className="text-slate-400 leading-relaxed">Interactive force-directed graph of every file and how they connect. Zoom, pan, and click to explore.</p>
          </div>

          {/* Feature 2 — Issue Detection */}
          <div className="rounded-xl border border-slate-800 bg-[#0d1326] p-8 transition-colors hover:border-slate-700">
            <svg className="mb-5 h-8 w-8 text-pink-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h3 className="font-['DM_Mono',monospace] text-xl font-medium text-white mb-2">Issue Detection</h3>
            <p className="text-slate-400 leading-relaxed">Automatically flags circular dependencies, god files, high coupling, and dead code — with severity ratings.</p>
          </div>

          {/* Feature 3 — Change Impact */}
          <div className="rounded-xl border border-slate-800 bg-[#0d1326] p-8 transition-colors hover:border-slate-700">
            <svg className="mb-5 h-8 w-8 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.866 8.21 8.21 0 003 2.48z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
            </svg>
            <h3 className="font-['DM_Mono',monospace] text-xl font-medium text-white mb-2">Change Impact</h3>
            <p className="text-slate-400 leading-relaxed">Select any file and instantly see its blast radius — direct and transitive dependents highlighted on the graph.</p>
          </div>

          {/* Feature 4 — Natural Language Search */}
          <div className="rounded-xl border border-slate-800 bg-[#0d1326] p-8 transition-colors hover:border-slate-700">
            <svg className="mb-5 h-8 w-8 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <h3 className="font-['DM_Mono',monospace] text-xl font-medium text-white mb-2">Natural Language Search</h3>
            <p className="text-slate-400 leading-relaxed">Ask anything about your codebase in plain English. RAG-powered answers with cited file and line references.</p>
          </div>

          {/* Feature 5 — AI Code Review */}
          <div className="rounded-xl border border-slate-800 bg-[#0d1326] p-8 transition-colors hover:border-slate-700">
            <svg className="mb-5 h-8 w-8 text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
            </svg>
            <h3 className="font-['DM_Mono',monospace] text-xl font-medium text-white mb-2">AI Code Review</h3>
            <p className="text-slate-400 leading-relaxed">Paste a snippet and get a review that considers your actual codebase patterns — not just generic best practices.</p>
          </div>

          {/* Feature 6 — File Metrics */}
          <div className="rounded-xl border border-slate-800 bg-[#0d1326] p-8 transition-colors hover:border-slate-700">
            <svg className="mb-5 h-8 w-8 text-cyan-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
            <h3 className="font-['DM_Mono',monospace] text-xl font-medium text-white mb-2">File Metrics</h3>
            <p className="text-slate-400 leading-relaxed">Sortable complexity table with risk highlighting — find your most critical and at-risk files at a glance.</p>
          </div>

        </div>
      </section>

      {/* Social Proof */}
      <section className="relative z-10 border-t border-b border-slate-800/60 bg-[#0a0f1e]/50 py-12">
        <div className="mx-auto max-w-7xl px-4 text-center">
          <p className="text-sm font-medium tracking-wide text-slate-500 uppercase">
            Built for modern engineering teams
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-8 gap-y-4">
            <span className="font-['DM_Mono',monospace] text-lg text-slate-400">JavaScript</span>
            <span className="font-['DM_Mono',monospace] text-lg text-slate-400">TypeScript</span>
            <span className="font-['DM_Mono',monospace] text-lg text-slate-400">Python</span>
            <span className="font-['DM_Mono',monospace] text-lg text-slate-400">C#</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-12">
        <div className="mx-auto max-w-7xl px-4 text-center">
          <p className="text-sm text-slate-600">
            Built by Leutrim Istrefi, Rinor Abazi & Samir Sahiti
          </p>
        </div>
      </footer>
    </div>
  );
}
