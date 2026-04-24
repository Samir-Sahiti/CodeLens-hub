import { useState, useEffect } from 'react';
import { Link, Outlet, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRepo } from '../context/RepoContext';
import { apiUrl } from '../lib/api';
import OnboardingModal from './OnboardingModal';

function useTokenUsage(session) {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    const fetch_ = () =>
      fetch(apiUrl('/api/usage/today'), { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d) setUsage(d); })
        .catch(() => {});
    fetch_();
    const id = setInterval(fetch_, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [session?.access_token]);

  return usage;
}

export default function Layout() {
  const { user, session, signOut } = useAuth();
  const { repo, issueCount } = useRepo();
  const tokenUsage = useTokenUsage(session);
  const location = useLocation();
  const { repoId } = useParams();
  const [searchParams] = useSearchParams();
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);

  const activeTab = searchParams.get('tab') || 'graph';

  // Show onboarding modal on first dashboard visit
  useEffect(() => {
    if (
      location.pathname === '/dashboard' &&
      !localStorage.getItem('codelens_onboarding_complete')
    ) {
      setIsOnboardingOpen(true);
    }
  }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
  };

  const repoNavItems = [
    { label: 'Graph',        tab: 'graph',        icon: GraphIcon    },
    { label: 'Metrics',      tab: 'metrics',      icon: MetricsIcon  },
    { label: 'Files',        tab: 'files',        icon: FilesIcon    },
    { label: 'Dependencies', tab: 'dependencies', icon: DepsIcon     },
    { label: 'Issues',       tab: 'issues',       icon: IssuesIcon   },
    { label: 'Search',       tab: 'search',       icon: SearchIcon   },
    { label: 'Code Review',  tab: 'review',       icon: ReviewIcon   },
    { label: 'Settings',     tab: 'settings',     icon: SettingsIcon },
  ];

  return (
    <div className="flex min-h-screen bg-[#0c0d14]">
      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      {/*
        Responsive behaviour:
        - < lg  (< 1024px): icon-only, w-14
        - >= lg (≥ 1024px): full width, w-64
      */}
      <div className="flex w-14 lg:w-64 shrink-0 flex-col border-r border-gray-800/60 bg-[#111218]">

        {/* Brand */}
        <div className="flex h-16 items-center justify-center lg:justify-start px-0 lg:px-6 border-b border-gray-800">
          <Link
            to="/dashboard"
            className="font-bold tracking-tight text-white hover:text-gray-200 transition-colors"
          >
            <span className="hidden lg:inline text-xl">CodeLens</span>
            <span className="lg:hidden text-sm">CL</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-1.5 lg:px-3 py-4 overflow-y-auto">
          {repoId ? (
            /* ── Repo context nav ── */
            <>
              {/* Back link */}
              <Link
                to="/dashboard"
                title="Repositories"
                className="flex items-center justify-center lg:justify-start gap-2 rounded-md px-2 lg:px-3 py-2 text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors mb-2"
              >
                <ArrowLeftIcon className="h-4 w-4 shrink-0" />
                <span className="hidden lg:inline">Repositories</span>
              </Link>

              {/* Repo identity */}
              <div className="hidden lg:block px-3 py-2 mb-1">
                <p
                  className="text-sm font-semibold text-white truncate"
                  title={repo?.full_name || repo?.name || ''}
                >
                  {repo?.name || '…'}
                </p>
                {repo?.status && <StatusBadge status={repo.status} />}
              </div>

              <div className="hidden lg:block border-t border-gray-800 my-2" />

              {/* Tab nav items */}
              {repoNavItems.map(({ label, tab, icon: Icon }) => {
                const isActive = activeTab === tab;
                return (
                  <Link
                    key={tab}
                    to={`/repo/${repoId}?tab=${tab}`}
                    title={label}
                    className={`flex items-center justify-center lg:justify-start gap-3 rounded-md px-2 lg:px-3 py-2 text-sm font-medium transition-colors border-l-2 ${
                      isActive
                        ? 'bg-indigo-500/10 border-indigo-500 text-white'
                        : 'text-gray-400 border-transparent hover:bg-gray-800/60 hover:text-white'
                    }`}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="hidden lg:inline">{label}</span>
                    {tab === 'issues' && issueCount > 0 && (
                      <span className="hidden lg:inline ml-auto rounded-full bg-red-500/80 px-1.5 py-0.5 text-xs font-semibold text-white">
                        {issueCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </>
          ) : (
            /* ── Dashboard nav ── */
            <Link
              to="/dashboard"
              title="Dashboard"
              className={`flex items-center justify-center lg:justify-start gap-3 rounded-md px-2 lg:px-3 py-2 text-sm font-medium transition-colors border-l-2 ${
                location.pathname.startsWith('/dashboard') || location.pathname === '/'
                  ? 'bg-indigo-500/10 border-indigo-500 text-white'
                  : 'text-gray-400 border-transparent hover:bg-gray-800/60 hover:text-white'
              }`}
            >
              <HomeIcon className="h-5 w-5 shrink-0" />
              <span className="hidden lg:inline">Dashboard</span>
            </Link>
          )}
        </nav>

        {/* ── User / Sign-out footer ── */}
        <div className="border-t border-gray-800 p-2 lg:p-4">
          <div className="flex items-center justify-center lg:justify-start gap-3 mb-3">
            <div className="h-8 w-8 overflow-hidden rounded-full bg-gray-800 shrink-0">
              {user?.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-bold text-gray-400 uppercase">
                  {user?.email?.charAt(0) || user?.user_metadata?.user_name?.charAt(0) || '?'}
                </div>
              )}
            </div>
            <div className="hidden lg:flex flex-col text-sm">
              <span className="font-medium text-white truncate max-w-[140px]">
                {user?.user_metadata?.user_name || user?.email || 'User'}
              </span>
            </div>
          </div>

          {/* Token usage indicator (US-042) */}
          {tokenUsage && (
            <div className="hidden lg:block mb-2 px-2">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Today</span>
                <span>{(tokenUsage.used / 1000).toFixed(1)}K / {(tokenUsage.limit / 1000).toFixed(0)}K tokens</span>
              </div>
              <div className="h-1 w-full rounded-full bg-gray-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    tokenUsage.used / tokenUsage.limit > 0.9 ? 'bg-red-500' :
                    tokenUsage.used / tokenUsage.limit > 0.7 ? 'bg-yellow-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${Math.min(100, (tokenUsage.used / tokenUsage.limit) * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          )}

          {/* Show introduction again */}
          <button
            onClick={() => setIsOnboardingOpen(true)}
            title="Show introduction again"
            className="flex w-full items-center justify-center lg:justify-start gap-2 rounded-md px-2 lg:px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition-colors mb-1"
          >
            <InfoIcon className="h-4 w-4 shrink-0" />
            <span className="hidden lg:inline">Show introduction again</span>
          </button>

          <button
            onClick={handleSignOut}
            title="Sign out"
            className="flex w-full items-center justify-center lg:justify-start gap-2 rounded-md px-2 lg:px-3 py-2 text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <SignOutIcon className="h-4 w-4 shrink-0" />
            <span className="hidden lg:inline">Sign out</span>
          </button>
        </div>
      </div>

      {/* ── Main Content Area ── */}
      <main className="flex-1 overflow-y-auto min-w-0">
        <Outlet />
      </main>

      {/* Onboarding Modal */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const styles = {
    ready:    'bg-green-500/10 text-green-400 ring-1 ring-inset ring-green-500/20',
    failed:   'bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/20',
    indexing: 'bg-blue-500/10 text-blue-400 ring-1 ring-inset ring-blue-500/20 animate-pulse',
    pending:  'bg-gray-500/10 text-gray-400 ring-1 ring-inset ring-gray-500/20 animate-pulse',
  };
  const label =
    status === 'pending'
      ? 'Indexing'
      : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${styles[status] || styles.pending}`}>
      {label}
    </span>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function HomeIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}

function ArrowLeftIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  );
}

function GraphIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
    </svg>
  );
}

function MetricsIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

function IssuesIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
    </svg>
  );
}

function SearchIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

function ReviewIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
    </svg>
  );
}

function SignOutIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
    </svg>
  );
}

function InfoIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  );
}

function FilesIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
    </svg>
  );
}

function SettingsIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function DepsIcon(props) {
  return (
    <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  );
}
