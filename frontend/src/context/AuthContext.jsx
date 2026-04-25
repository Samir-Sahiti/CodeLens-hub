import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { apiUrl } from '../lib/api';

const AuthContext = createContext(null);

/**
 * Upserts the user's GitHub access token into the profiles table.
 * Called once after a fresh GitHub sign-in when provider_token is available.
 * Retries once after 2 seconds on failure.
 */
async function syncProfile(session, attempt = 0) {
  if (!session?.provider_token) return;

  try {
    const res = await fetch(apiUrl('/api/auth/profile'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        github_access_token: session.provider_token,
        github_username: session.user?.user_metadata?.user_name ?? null,
      }),
    });

    if (!res.ok && attempt === 0) {
      // Retry once after 2 seconds
      await new Promise(r => setTimeout(r, 2000));
      return syncProfile(session, 1);
    }
  } catch (err) {
    if (attempt === 0) {
      // Non-fatal retry on network error
      console.warn('[AuthContext] syncProfile failed, retrying in 2s:', err.message);
      await new Promise(r => setTimeout(r, 2000));
      return syncProfile(session, 1);
    }
    // Non-fatal — token can be re-synced on next sign-in
    console.error('[AuthContext] Failed to sync profile after retry:', err);
  }
}

export function AuthProvider({ children }) {
  const [session,      setSession]      = useState(undefined); // undefined = still loading
  const [user,         setUser]         = useState(null);
  const [syncError,    setSyncError]    = useState(null);

  useEffect(() => {
    // Hydrate from localStorage on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
      setUser(session?.user ?? null);
      if (session) {
        syncProfile(session).catch(err => setSyncError(err.message));
      }
    });

    // Keep in sync with Supabase auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session ?? null);
        setUser(session?.user ?? null);

        // Sync GitHub token to backend on every fresh sign-in
        if (event === 'SIGNED_IN') {
          setSyncError(null);
          try {
            await syncProfile(session);
          } catch (err) {
            setSyncError(err.message);
          }
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // session === undefined means we haven't heard back from getSession yet
  const loading = session === undefined;

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut, syncError }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>');
  return ctx;
}
