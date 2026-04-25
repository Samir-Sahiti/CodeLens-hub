import { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { useToast } from '../components/Toast';
import { LANGUAGE_COLORS } from '../lib/constants';
import ConnectGitHubModal from '../components/ConnectGitHubModal';
import UploadRepoModal from '../components/UploadRepoModal';
import CreateTeamModal from '../components/CreateTeamModal';
import { Badge, Banner, Button, EmptyState, Panel, SearchInput, Select, Skeleton, Toolbar } from '../components/ui/Primitives';
import {
  ArrowRight,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Search,
  SortAsc,
  Trash2,
  Upload,
  Users,
} from '../components/ui/Icons';

function timeAgo(dateString) {
  if (!dateString) return '';
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateString).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function LanguageMiniBar({ languages }) {
  if (!languages?.length) return <div className="mb-5 h-1.5 rounded-full bg-surface-800" />;
  const total = languages.reduce((s, l) => s + l.count, 0);
  if (!total) return null;
  return (
    <div className="mb-5 flex h-1.5 w-full overflow-hidden rounded-full shadow-inner bg-surface-800" title="Language distribution">
      {languages.map(l => (
        <div
          key={l.language}
          style={{
            width: `${(l.count / total) * 100}%`,
            backgroundColor: LANGUAGE_COLORS[l.language] ?? LANGUAGE_COLORS.unknown,
          }}
          title={l.language}
        />
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const tone = {
    ready: 'success',
    failed: 'danger',
    indexing: 'accent',
    pending: 'warning',
  }[status] || 'subtle';
  const label = status === 'pending' ? 'Indexing' : status?.charAt(0).toUpperCase() + status?.slice(1);
  return <Badge tone={tone}>{label || 'Unknown'}</Badge>;
}

const RepoCard = memo(function RepoCard({ repo, onRetry, onDelete, isRetrying, style }) {
  const healthDot = {
    failed: 'bg-red-400',
    indexing: 'bg-accent animate-pulse',
    pending: 'bg-amber-400 animate-pulse',
    ready: 'bg-emerald-400',
  }[repo.status] ?? 'bg-surface-500';

  return (
    <Panel
      as="article"
      padded={false}
      style={style}
      className="group overflow-hidden transition-all hover:border-surface-600 hover:shadow-lg"
    >
      <Link to={`/repo/${repo.id}`} className="block">
        <div className="p-6">
          <LanguageMiniBar languages={repo.languages} />

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${healthDot}`} />
                <h2 className="truncate text-base font-semibold text-surface-50 group-hover:text-accent-soft">
                  {repo.name}
                </h2>
              </div>
              <p className="mt-1 truncate text-xs text-surface-500">
                {repo.source === 'github' ? 'GitHub' : 'Upload'} · {repo.file_count ?? 0} files
                {repo.latest_job_summary?.progress_pct > 0 && (repo.status === 'pending' || repo.status === 'indexing') && (
                  <> · {repo.latest_job_summary.progress_pct}%</>
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <StatusBadge status={repo.status} />
              {repo.auto_sync_enabled && <Badge tone="accent">Auto-sync</Badge>}
              {repo.shared && repo.team_name && <Badge tone="subtle">{repo.team_name}</Badge>}
            </div>
          </div>
        </div>
      </Link>

      <div className="flex items-center justify-between gap-3 border-t border-surface-800 px-6 py-4 bg-surface-900/30">
        <span className="truncate text-xs text-surface-500">
          {repo.indexed_at
            ? `Indexed ${timeAgo(repo.indexed_at)}`
            : `Added ${timeAgo(repo.created_at)}`}
        </span>
        <Toolbar className="shrink-0">
          {!repo.shared && (
            <Button
              size="sm"
              variant="outline"
              icon={RefreshCw}
              loading={isRetrying}
              className="hover:[&>svg]:animate-spin"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRetry(e, repo.id); }}
            >
              Retry
            </Button>
          )}
          {!repo.shared && (
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(e, repo.id); }}
            >
              Delete
            </Button>
          )}
          <Button as={Link} to={`/repo/${repo.id}`} size="sm" variant="ghost" className="hidden sm:inline-flex cursor-pointer hover:text-white">
            Open <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </Toolbar>
      </div>
    </Panel>
  );
});

const SORT_OPTIONS = [
  { value: 'updated', label: 'Last updated' },
  { value: 'name', label: 'Name A-Z' },
  { value: 'status', label: 'Status' },
];

export default function Dashboard() {
  const { session } = useAuth();
  const toast = useToast();

  const [repos, setRepos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  const [retryingIds, setRetryingIds] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('updated');

  const fetchRepos = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(apiUrl('/api/repos'), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch repositories');
      const data = await res.json();
      setRepos(data.repos || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => { fetchRepos(); }, [fetchRepos]);

  useEffect(() => {
    const working = repos.some(r => r.status === 'pending' || r.status === 'indexing');
    if (!working) return;
    const id = setInterval(fetchRepos, 5000);
    return () => clearInterval(id);
  }, [repos.map(r => r.status).join(','), fetchRepos]);

  const handleRetry = async (e, repoId) => {
    e.preventDefault(); e.stopPropagation();
    if (retryingIds.has(repoId)) return;
    setRetryingIds(prev => new Set(prev).add(repoId));
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/reindex`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to restart indexing');
      }
      await fetchRepos();
      toast.success('Re-indexing started');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRetryingIds(prev => { const n = new Set(prev); n.delete(repoId); return n; });
    }
  };

  const handleDelete = async (e, repoId) => {
    e.preventDefault(); e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this repository? This cannot be undone.')) return;
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error('Failed to delete repository');
      await fetchRepos();
      toast.success('Repository deleted');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const sortedRepos = useMemo(() => {
    const filtered = repos.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()));
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'status') return (a.status ?? '').localeCompare(b.status ?? '');
      const aDate = a.indexed_at ?? a.created_at;
      const bDate = b.indexed_at ?? b.created_at;
      return new Date(bDate) - new Date(aDate);
    });
  }, [repos, search, sortBy]);

  const ownedRepos = sortedRepos.filter(r => !r.shared);
  const sharedRepos = sortedRepos.filter(r => r.shared);

  if (isLoading) {
    return (
      <div className="min-h-screen p-4 text-white sm:p-6 lg:p-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <Skeleton className="h-7 w-52" />
            <Skeleton className="mt-2 h-4 w-36" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-36" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Panel key={i} className="space-y-4">
              <Skeleton className="h-[3px] w-full" />
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-9 w-full" />
            </Panel>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 text-white sm:p-6 lg:p-8">
      <div className="mb-8">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-surface-500">Workspace</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Repositories</h1>
            <p className="mt-1 text-sm text-surface-500">{repos.length} connected repositories</p>
          </div>
          <Toolbar>
            <Button icon={Users} variant="outline" onClick={() => setIsCreateTeamOpen(true)}>Create Team</Button>
            <Button icon={Upload} variant="secondary" onClick={() => setIsUploadModalOpen(true)}>Upload</Button>
            <Button icon={GitBranch} variant="primary" onClick={() => setIsConnectModalOpen(true)}>Connect GitHub</Button>
          </Toolbar>
        </div>

        {repos.length > 0 && (
          <Toolbar>
            <SearchInput
              className="w-full max-w-sm"
              placeholder="Filter repositories"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="relative">
              <SortAsc className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" />
              <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} inputClassName="pl-9">
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
          </Toolbar>
        )}
      </div>

      {error && <Banner tone="danger" className="mb-6">{error}</Banner>}

      {repos.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No repositories connected"
          description="Connect GitHub or upload a project archive to build a searchable dependency map."
          className="min-h-[28rem]"
          actions={(
            <>
              <Button icon={Upload} onClick={() => setIsUploadModalOpen(true)}>Upload Project</Button>
              <Button icon={GitBranch} variant="primary" onClick={() => setIsConnectModalOpen(true)}>Connect GitHub</Button>
            </>
          )}
        />
      ) : (
        <>
          {ownedRepos.length > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {ownedRepos.map((repo, i) => (
                <RepoCard
                  key={repo.id}
                  repo={repo}
                  onRetry={handleRetry}
                  onDelete={handleDelete}
                  isRetrying={retryingIds.has(repo.id)}
                  style={{ animation: `slideUp 220ms ease ${i * 35}ms both` }}
                />
              ))}
            </div>
          )}

          {sharedRepos.length > 0 && (
            <div className="mt-10">
              <div className="mb-4 flex items-center gap-2">
                <Users className="h-4 w-4 text-surface-500" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-surface-400">Team Repositories</h2>
                <Badge tone="subtle">{sharedRepos.length}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {sharedRepos.map((repo, i) => (
                  <RepoCard
                    key={repo.id}
                    repo={repo}
                    onRetry={handleRetry}
                    onDelete={handleDelete}
                    isRetrying={retryingIds.has(repo.id)}
                    style={{ animation: `slideUp 220ms ease ${i * 35}ms both` }}
                  />
                ))}
              </div>
            </div>
          )}

          {search && ownedRepos.length === 0 && sharedRepos.length === 0 && (
            <EmptyState icon={Search} title="No matching repositories" description={`No repositories match "${search}".`} />
          )}
        </>
      )}

      <ConnectGitHubModal isOpen={isConnectModalOpen} onClose={() => setIsConnectModalOpen(false)} existingRepos={repos} onConnected={fetchRepos} />
      <UploadRepoModal isOpen={isUploadModalOpen} onClose={() => setIsUploadModalOpen(false)} onConnected={fetchRepos} />
      <CreateTeamModal
        isOpen={isCreateTeamOpen}
        onClose={() => setIsCreateTeamOpen(false)}
        onCreated={(team, count) => {
          fetchRepos();
          toast.success(`Team "${team.name}" created with ${count} collaborator${count !== 1 ? 's' : ''} added.`);
        }}
      />
    </div>
  );
}
