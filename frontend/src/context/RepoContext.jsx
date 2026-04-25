import { createContext, useContext, useState, useCallback } from 'react';

const RepoContext = createContext(null);

export function RepoProvider({ children }) {
  const [repo,       setRepo]       = useState(null);
  const [issueCount, setIssueCount] = useState(0);
  const [isLoading,  setIsLoading]  = useState(false);
  const [error,      setError]      = useState(null);

  /**
   * refreshRepo — call this to signal that the repo data should be
   * re-fetched by whatever component owns the fetch logic. Components
   * can listen for a refreshKey change to trigger re-fetches.
   */
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshRepo = useCallback(() => setRefreshKey(k => k + 1), []);

  return (
    <RepoContext.Provider value={{
      repo,       setRepo,
      issueCount, setIssueCount,
      isLoading,  setIsLoading,
      error,      setError,
      refreshKey, refreshRepo,
    }}>
      {children}
    </RepoContext.Provider>
  );
}

export function useRepo() {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error('useRepo must be used within a RepoProvider');
  return ctx;
}
