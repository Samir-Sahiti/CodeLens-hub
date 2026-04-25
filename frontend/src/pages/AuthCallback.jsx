import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { LoadingMark } from '../components/ui/Primitives';

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

  return <LoadingMark label="Signing you in" detail="Completing GitHub authentication" />;
}
