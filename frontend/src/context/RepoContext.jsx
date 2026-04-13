import { createContext, useContext, useState } from 'react';

const RepoContext = createContext(null);

export function RepoProvider({ children }) {
  const [repo, setRepo] = useState(null);
  const [issueCount, setIssueCount] = useState(0);

  return (
    <RepoContext.Provider value={{ repo, setRepo, issueCount, setIssueCount }}>
      {children}
    </RepoContext.Provider>
  );
}

export function useRepo() {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error('useRepo must be used within a RepoProvider');
  return ctx;
}
