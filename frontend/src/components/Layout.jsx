import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { Link, Outlet, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useAuth }  from '../context/AuthContext';
import { useRepo }  from '../context/RepoContext';
import { apiUrl }   from '../lib/api';
import NotificationBell from './NotificationBell';
import Tooltip from './ui/Tooltip';
import { Badge, IconButton } from './ui/Primitives';

import {
  LayoutDashboard, GitGraph, BarChart3, FolderTree,
  Package, ShieldAlert, Sparkles, Code2, Settings, GitBranch,
  LogOut, HelpCircle, ChevronLeft, ChevronRight, ArrowLeft,
  Star,
} from './ui/Icons';

const OnboardingGuide = lazy(() => import('./OnboardingGuide'));

// ── Token usage hook ─────────────────────────────────────────────────────────
function useTokenUsage(session) {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    const fetch_ = () =>
      fetch(apiUrl('/api/usage/today'), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (!cancelled && d) setUsage(d); })
        .catch(() => {});
    fetch_();
    const id = setInterval(fetch_, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [session?.access_token]);

  return usage;
}

// ── Keyboard shortcut hook ───────────────────────────────────────────────────
function useKeyboardShortcut(key, callback, options = {}) {
  const { ctrl = true } = options;
  useEffect(() => {
    const handler = (e) => {
      if ((ctrl ? e.ctrlKey || e.metaKey : true) && e.key === key) {
        e.preventDefault();
        callback();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [key, callback, ctrl]);
}

export default function Layout() {
  const { user, session, signOut, onboardingSeen, setOnboardingSeen } = useAuth();
  const { repo, issueCount }       = useRepo();
  const tokenUsage                 = useTokenUsage(session);
  const location                   = useLocation();
  const { repoId }                 = useParams();
  const [searchParams]             = useSearchParams();
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isGuideRendered, setIsGuideRendered] = useState(false);
  const [deepLinkSlug, setDeepLinkSlug] = useState(null);
  const [firstRepoId, setFirstRepoId] = useState(null);
  const closeGuideTimerRef = useRef(null);

  // Sidebar collapse — persisted in localStorage
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('cl_sidebar_collapsed') === 'true'; }
    catch { return false; }
  });

  const toggleSidebar = useCallback(() => {
    setCollapsed(v => {
      const next = !v;
      try { localStorage.setItem('cl_sidebar_collapsed', String(next)); } catch {}
      return next;
    });
  }, []);

  // Cmd/Ctrl+B toggles sidebar
  useKeyboardShortcut('b', toggleSidebar);

  const activeTab = searchParams.get('tab') || 'graph';

  const openGuide = useCallback((slug) => {
    if (closeGuideTimerRef.current) {
      window.clearTimeout(closeGuideTimerRef.current);
      closeGuideTimerRef.current = null;
    }
    setDeepLinkSlug(slug || null);
    setIsGuideRendered(true);
    setIsGuideOpen(true);
  }, []);

  useEffect(() => {
    const slug = searchParams.get('guide');
    if (slug) {
      openGuide(slug);
    }
  }, [openGuide, searchParams]);

  useEffect(() => {
    const handleOpenGuide = (event) => {
      openGuide(event.detail?.slug);
    };
    window.addEventListener('codelens:open-guide', handleOpenGuide);
    return () => window.removeEventListener('codelens:open-guide', handleOpenGuide);
  }, [openGuide]);

  useEffect(() => {
    if (!session?.access_token) {
      setFirstRepoId(null);
      return undefined;
    }

    let cancelled = false;
    fetch(apiUrl('/api/repos'), {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (cancelled) return;
        const repos = data?.repos || [];
        const firstReady = repos.find(r => r.status === 'ready') || repos[0];
        setFirstRepoId(firstReady?.id ? String(firstReady.id) : null);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [session?.access_token]);

  const closeGuide = useCallback(async () => {
    setIsGuideOpen(false);
    if (closeGuideTimerRef.current) window.clearTimeout(closeGuideTimerRef.current);
    closeGuideTimerRef.current = window.setTimeout(() => {
      setIsGuideRendered(false);
      closeGuideTimerRef.current = null;
    }, 300);
    if (!session?.access_token || onboardingSeen) return;

    try {
      const res = await fetch(apiUrl('/api/auth/onboarding-seen'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setOnboardingSeen(data.onboarding_seen ?? new Date().toISOString());
      }
    } catch {}
  }, [onboardingSeen, session?.access_token, setOnboardingSeen]);

  useEffect(() => () => {
    if (closeGuideTimerRef.current) window.clearTimeout(closeGuideTimerRef.current);
  }, []);

  const repoNavItems = [
    { label: 'Graph',        tab: 'graph',        Icon: GitGraph     },
    { label: 'Metrics',      tab: 'metrics',      Icon: BarChart3    },
    { label: 'Files',        tab: 'files',        Icon: FolderTree   },
    { label: 'Dependencies', tab: 'dependencies', Icon: Package      },
    { label: 'Pull Requests', tab: 'pulls',       Icon: GitBranch    },
    { label: 'Issues',       tab: 'issues',       Icon: ShieldAlert  },
    { label: 'Agent',        tab: 'agent',        Icon: Sparkles     },
    { label: 'Tours',        tab: 'tours',        Icon: Star         },
    { label: 'Code Review',  tab: 'review',       Icon: Code2        },
    { label: 'Settings',     tab: 'settings',     Icon: Settings     },
  ];

  const sidebarW = collapsed ? 'w-14' : 'w-14 lg:w-64';

  return (
    <div className="flex min-h-screen app-shell-bg text-surface-100">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <div
        className={`flex ${sidebarW} shrink-0 flex-col border-r border-surface-800 bg-surface-900/95 transition-[width] duration-200 ease-in-out overflow-hidden`}
        style={{ willChange: 'width' }}
      >

        {/* Brand + collapse toggle */}
        <div className="flex h-16 items-center justify-between gap-2 px-3 border-b border-surface-800 shrink-0">
          {!collapsed && (
            <Link
              to="/dashboard"
              className="hidden items-center gap-2 font-mono text-base font-bold tracking-tight text-white transition-colors hover:text-accent-soft lg:flex"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent-soft">CL</span>
              <span>CodeLens</span>
            </Link>
          )}
          {collapsed && (
            <Link to="/dashboard" className="flex w-full items-center justify-center font-mono text-sm font-bold text-accent-soft">
              CL
            </Link>
          )}
          <div className={`flex items-center gap-1 ${collapsed ? 'mx-auto flex-col' : ''}`}>
            <IconButton
              onClick={() => openGuide()}
              label="Open guide"
              icon={HelpCircle}
            />
            <IconButton
              onClick={toggleSidebar}
              label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              icon={collapsed ? ChevronRight : ChevronLeft}
            />
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-1.5 py-4">
          {repoId ? (
            <>
              {/* Back to dashboard */}
              <NavItem
                collapsed={collapsed}
                to="/dashboard"
                icon={ArrowLeft}
                label="Repositories"
                isActive={false}
                className="mb-2"
              />

              {/* Repo name */}
              {!collapsed && (
                <div className="mb-1 hidden px-3 py-2 lg:block">
                  <p
                    className="truncate text-sm font-semibold text-white"
                    title={repo?.full_name || repo?.name || ''}
                  >
                    {repo?.name || '…'}
                  </p>
                  {repo?.status && <StatusBadge status={repo.status} />}
                </div>
              )}

              {!collapsed && <div className="my-2 hidden border-t border-surface-800 lg:block" />}

              {/* Tab nav items */}
              {repoNavItems.map(({ label, tab, Icon }) => {
                const isActive = activeTab === tab;
                return (
                  <NavItem
                    key={tab}
                    collapsed={collapsed}
                    to={`/repo/${repoId}?tab=${tab}`}
                    icon={Icon}
                    label={label}
                    isActive={isActive}
                    badge={tab === 'issues' && issueCount > 0 ? issueCount : null}
                  />
                );
              })}
            </>
          ) : (
            <NavItem
              collapsed={collapsed}
              to="/dashboard"
              icon={LayoutDashboard}
              label="Dashboard"
              isActive={
                location.pathname.startsWith('/dashboard') ||
                location.pathname === '/'
              }
            />
          )}
        </nav>

        {/* ── User / Sign-out footer ── */}
        <div className="shrink-0 border-t border-surface-800 p-2">

          {/* User avatar + name */}
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-center lg:justify-start lg:gap-3'} mb-2`}>
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-800 ring-1 ring-surface-700">
              {user?.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Avatar"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs font-bold uppercase text-surface-400">
                  {user?.email?.charAt(0) || user?.user_metadata?.user_name?.charAt(0) || '?'}
                </div>
              )}
            </div>
            {!collapsed && (
              <div className="hidden min-w-0 flex-col text-sm lg:flex">
                <span className="max-w-[140px] truncate font-medium text-white">
                  {user?.user_metadata?.user_name || user?.email || 'User'}
                </span>
              </div>
            )}
          </div>

          {/* Token usage bar */}
          {tokenUsage && !collapsed && (
            <div className="mb-2 hidden px-1 lg:block">
              <div className="mb-1 flex justify-between text-xs text-surface-500">
                <span>Tokens today</span>
                <span>
                  {(tokenUsage.used / 1000).toFixed(1)}K /{' '}
                  {(tokenUsage.limit / 1000).toFixed(0)}K
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    tokenUsage.used / tokenUsage.limit > 0.9 ? 'bg-red-500' :
                    tokenUsage.used / tokenUsage.limit > 0.7 ? 'bg-yellow-500' :
                    'bg-accent'
                  }`}
                  style={{ width: `${Math.min(100, (tokenUsage.used / tokenUsage.limit) * 100).toFixed(1)}%` }}
                />
              </div>
            </div>
          )}

          {/* Notifications (US-077) */}
          <NotificationBell collapsed={collapsed} />

          {/* Show introduction */}
          <NavItem
            collapsed={collapsed}
            onClick={() => openGuide()}
            icon={HelpCircle}
            label="Guide"
            isActive={false}
            as="button"
          />

          {/* Sign out */}
          <NavItem
            collapsed={collapsed}
            onClick={signOut}
            icon={LogOut}
            label="Sign out"
            isActive={false}
            as="button"
            className="text-gray-500 hover:text-red-400"
          />
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      {isGuideRendered && (
        <Suspense fallback={null}>
          <OnboardingGuide
            open={isGuideOpen}
            onClose={closeGuide}
            repoId={repoId}
            firstRepoId={firstRepoId}
            deepLinkSlug={deepLinkSlug}
          />
        </Suspense>
      )}
    </div>
  );
}

// ── NavItem ─────────────────────────────────────────────────────────────────
function NavItem({
  collapsed,
  to,
  onClick,
  icon: Icon,
  label,
  isActive,
  badge,
  as = 'link',
  className = '',
}) {
  const baseClass = [
    'flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium',
    'transition-colors duration-150 w-full border-l-2',
    isActive
      ? 'border-accent bg-accent/10 text-white'
      : 'border-transparent text-surface-400 hover:bg-surface-800/70 hover:text-white',
    collapsed ? 'justify-center' : 'justify-center lg:justify-start',
    className,
  ].join(' ');

  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="hidden truncate lg:inline">{label}</span>}
      {!collapsed && badge != null && (
        <span className="hidden rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold leading-none text-white lg:ml-auto lg:inline">
          {badge}
        </span>
      )}
    </>
  );

  const el = as === 'button'
    ? <button onClick={onClick} title={collapsed ? label : undefined} className={baseClass}>{content}</button>
    : <Link to={to} title={collapsed ? label : undefined} className={baseClass}>{content}</Link>;

  if (collapsed) {
    return (
      <Tooltip content={label} position="right">
        {el}
      </Tooltip>
    );
  }
  return el;
}

// ── StatusBadge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const styles = {
    ready:    'success',
    failed:   'danger',
    indexing: 'accent',
    pending:  'subtle',
  };
  const label =
    status === 'pending'
      ? 'Indexing'
      : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <Badge tone={styles[status] || styles.pending} className="mt-1">
      {label}
    </Badge>
  );
}
