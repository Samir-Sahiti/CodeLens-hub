import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

/**
 * Upserts the user's GitHub access token into the profiles table.
 * Called once after a fresh GitHub sign-in when provider_token is available.
 */
async function syncProfile(session) {
  if (!session?.provider_token) return;

  try {
    await fetch('/api/auth/profile', {
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
  } catch (err) {
    // Non-fatal — token can be re-synced on next sign-in
    console.error('[AuthContext] Failed to sync profile:', err);
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [user, setUser]       = useState(null);

  useEffect(() => {
    // Hydrate from localStorage on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session ?? null);
      setUser(session?.user ?? null);
    });

    // Keep in sync with Supabase auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session ?? null);
        setUser(session?.user ?? null);

        // Sync GitHub token to backend on every fresh sign-in
        if (event === 'SIGNED_IN') {
          await syncProfile(session);
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
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
