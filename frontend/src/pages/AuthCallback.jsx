import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/**
 * AuthCallback — Supabase redirects the browser here after GitHub OAuth.
 * The URL fragment (#access_token=...) is picked up automatically by
 * the Supabase client; we just need to wait for the session to be
 * established and then forward the user to /dashboard.
 *
 * Route: /auth/callback
 * Registered as the "Redirect URL" in:
 *   - Supabase Dashboard → Authentication → URL Configuration
 */
export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // onAuthStateChange fires once the fragment tokens are exchanged
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session) {
          navigate('/dashboard', { replace: true });
        } else if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
          navigate('/login', { replace: true });
        }
      }
    );

    // Safety net: if the session is already set (e.g. fast redirect), navigate immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate('/dashboard', { replace: true });
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-950 text-white">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      <p className="text-sm text-gray-400">Signing you in…</p>
    </div>
  );
}
