import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState(null);

  // Already signed in → go straight to dashboard
  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, loading, navigate]);

  const handleGitHubLogin = async () => {
    setIsSigningIn(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        // Supabase will redirect here after the GitHub consent screen
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'read:user repo',
      },
    });

    if (error) {
      setError(error.message);
      setIsSigningIn(false);
    }
    // On success Supabase automatically redirects the browser — no further action needed
  };

  // Don't flash the form while checking if already signed in
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-8 shadow-xl">
        {/* Logo / wordmark */}
        <div className="mb-6 flex items-center gap-2">
          <span className="text-2xl font-bold tracking-tight text-white">CodeLens</span>
        </div>

        <p className="mb-8 text-sm text-gray-400">
          Understand any codebase — instantly.
        </p>

        {/* Error banner */}
        {error && (
          <div
            id="login-error"
            role="alert"
            className="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300"
          >
            {error}
          </div>
        )}

        <button
          id="github-login-btn"
          onClick={handleGitHubLogin}
          disabled={isSigningIn}
          className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSigningIn ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
              Redirecting…
            </>
          ) : (
            <>
              {/* GitHub SVG mark */}
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .322.216.694.825.576C20.565 21.796 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
              </svg>
              Sign in with GitHub
            </>
          )}
        </button>
      </div>
    </div>
  );
}
