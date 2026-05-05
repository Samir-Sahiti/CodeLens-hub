import { useMemo, useState, useEffect, useCallback, memo } from 'react';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { getSyntaxLanguage } from '../lib/constants';
import Modal from './ui/Modal';
import { Button, Badge } from './ui/Primitives';
import {
  Package, Lock, ShieldAlert, GitMerge,
  FileWarning, Link2, FileX, Search,
  ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, TrendingUp,
  Copy, Sparkles,
} from './ui/Icons';

// ── Group config ─────────────────────────────────────────────────────────────
const GROUP_ORDER = [
  { type: 'vulnerable_dependency', label: 'Vulnerable Dependencies',           Icon: Package       },
  { type: 'hardcoded_secret',      label: 'Hardcoded Secrets',                 Icon: Lock          },
  { type: 'missing_auth',          label: 'Potentially Unauthenticated Routes', Icon: AlertTriangle },
  { type: 'insecure_pattern',      label: 'Insecure Code Patterns',            Icon: ShieldAlert   },
  { type: 'circular_dependency',   label: 'Circular Dependencies',             Icon: GitMerge      },
  { type: 'god_file',              label: 'God Files',                         Icon: FileWarning   },
  { type: 'high_coupling',         label: 'High Coupling',                     Icon: Link2         },
  { type: 'dead_code',             label: 'Dead Code',                         Icon: FileX         },
  { type: 'refactoring_candidate', label: 'Refactoring Candidates',            Icon: TrendingUp    },
];

function getBadgeStyles(severity) {
  switch (severity?.toLowerCase()) {
    case 'high':    return 'bg-red-500/20 text-red-400 ring-1 ring-inset ring-red-500/30';
    case 'medium':  return 'bg-orange-500/20 text-orange-400 ring-1 ring-inset ring-orange-500/30';
    case 'low':     return 'bg-yellow-500/20 text-yellow-400 ring-1 ring-inset ring-yellow-500/30';
    default:        return 'bg-gray-500/20 text-gray-400 ring-1 ring-inset ring-gray-500/30';
  }
}

// ── IssueGroup ────────────────────────────────────────────────────────────────
const IssueGroup = memo(function IssueGroup({ type, label, Icon, issues, nodeMap, onIssueClick, onSuppress, onDisableRule, actionsDisabled }) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="mb-6 last:mb-0">
      {/* Sticky header */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className="sticky top-0 z-10 w-full flex items-center justify-between bg-gray-950 border-b border-gray-800 shadow-sm pb-2 mb-3 pt-1 group"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-800 border border-gray-700">
            <Icon className="h-3.5 w-3.5 text-gray-400 group-hover:text-white transition-colors" />
          </div>
          <h2 className="text-base font-semibold text-gray-200 group-hover:text-white transition-colors">
            {label}
          </h2>
          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-500">
            {issues.length}
          </span>
        </div>
        {isOpen
          ? <ChevronUp className="h-4 w-4 text-gray-600" />
          : <ChevronDown className="h-4 w-4 text-gray-600" />
        }
      </button>

      {/* Collapsible body */}
      {isOpen && (
        <div
          className="grid gap-3"
          style={{ animation: 'fadeIn 180ms ease both' }}
        >
          {issues.map((issue, idx) => (
            <IssueCard
              key={issue.id || `${type}-${idx}`}
              issue={issue}
              type={type}
              onIssueClick={onIssueClick}
              onSuppress={onSuppress}
              onDisableRule={onDisableRule}
              actionsDisabled={actionsDisabled}
            />
          ))}
        </div>
      )}
    </div>
  );
});

// ── IssueCard ─────────────────────────────────────────────────────────────────
const IssueCard = memo(function IssueCard({ issue, type, onIssueClick, onSuppress, onDisableRule, actionsDisabled }) {
  return (
    <div
      onClick={() => onIssueClick(issue)}
      className="flex flex-col bg-gray-900/50 hover:bg-gray-800/80 border border-gray-800 hover:border-gray-700 rounded-xl p-5 cursor-pointer transition-all duration-200 hover:-translate-y-px hover:shadow-lg group"
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wider ${getBadgeStyles(issue.severity)}`}>
          {issue.severity || 'UNKNOWN'}
        </span>

        {/* Suppress button for secrets */}
        {type === 'hardcoded_secret' && (
          <button
            onClick={(e) => { e.stopPropagation(); onSuppress(e, issue); }}
            disabled={actionsDisabled}
            className="text-xs text-gray-500 hover:text-gray-200 underline transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            Mark as false positive
          </button>
        )}

        {/* Suppress button for unauthenticated routes */}
        {type === 'missing_auth' && (
          <button
            onClick={(e) => { e.stopPropagation(); onSuppress(e, issue); }}
            disabled={actionsDisabled}
            className="text-xs text-gray-500 hover:text-gray-200 underline transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            Mark as intentionally public
          </button>
        )}

        {/* Disable rule button for insecure patterns */}
        {type === 'insecure_pattern' && (
          <button
            onClick={(e) => { e.stopPropagation(); onDisableRule(e, issue); }}
            disabled={actionsDisabled}
            className="text-xs text-gray-500 hover:text-gray-200 underline transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            Disable this rule
          </button>
        )}
      </div>

      <p className="text-gray-300 text-sm mb-4 leading-relaxed whitespace-pre-wrap">
        {issue.description || 'No description available.'}
      </p>

      <div className="mt-auto flex flex-wrap gap-x-2 gap-y-1 rounded-lg border border-gray-800 bg-gray-950/50 p-3">
        {issue.file_paths.map((fp, i) => (
          <span key={fp} className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Only open file for non-dependency issues
              }}
              title={fp}
              className="font-mono text-xs text-gray-400 leading-loose break-all text-left hover:text-indigo-300 transition-colors cursor-pointer"
            >
              {fp}
            </button>
          </span>
        ))}
      </div>
    </div>
  );
});

function formatPercent(value) {
  const n = Number(value || 0);
  return `${Math.round(n * 100)}%`;
}

function DuplicationClusterCard({ cluster, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(cluster)}
      className="flex flex-col rounded-xl border border-gray-800 bg-gray-900/50 p-5 text-left transition-all duration-200 hover:-translate-y-px hover:border-gray-700 hover:bg-gray-800/80 hover:shadow-lg"
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wider ${getBadgeStyles(cluster.severity)}`}>
          {cluster.severity || 'low'}
        </span>
        <span className="text-xs text-gray-500">
          {cluster.member_count} chunks · {cluster.total_lines} duplicated lines · {formatPercent(cluster.similarity_min)}-{formatPercent(cluster.similarity_max)}
        </span>
      </div>

      <div className="grid gap-3">
        {(cluster.members || []).slice(0, 3).map((member) => (
          <div key={member.chunk_id} className="rounded-lg border border-gray-800 bg-gray-950/50 p-3">
            <p className="break-all font-mono text-xs text-indigo-300">
              {member.file_path}:{member.start_line}-{member.end_line}
            </p>
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-400">
              {member.excerpt}
            </p>
          </div>
        ))}
        {cluster.member_count > 3 && (
          <p className="text-xs text-gray-500">+ {cluster.member_count - 3} more duplicate member{cluster.member_count - 3 === 1 ? '' : 's'}</p>
        )}
      </div>
    </button>
  );
}

function DuplicationSection({ clusters, onOpen }) {
  const [isOpen, setIsOpen] = useState(true);
  if (!clusters.length) return null;

  return (
    <div className="mb-6 last:mb-0">
      <button
        type="button"
        onClick={() => setIsOpen(v => !v)}
        className="sticky top-0 z-10 w-full flex items-center justify-between bg-gray-950 border-b border-gray-800 shadow-sm pb-2 mb-3 pt-1 group"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-800 border border-gray-700">
            <Copy className="h-3.5 w-3.5 text-gray-400 group-hover:text-white transition-colors" />
          </div>
          <h2 className="text-base font-semibold text-gray-200 group-hover:text-white transition-colors">
            Duplication
          </h2>
          <span className="rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-500">
            {clusters.length}
          </span>
        </div>
        {isOpen
          ? <ChevronUp className="h-4 w-4 text-gray-600" />
          : <ChevronDown className="h-4 w-4 text-gray-600" />
        }
      </button>

      {isOpen && (
        <div className="grid gap-3" style={{ animation: 'fadeIn 180ms ease both' }}>
          {clusters.map((cluster) => (
            <DuplicationClusterCard key={cluster.id} cluster={cluster} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberPicker({ label, members, value, onChange }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-200 outline-none focus:border-indigo-500"
      >
        {members.map((member, index) => (
          <option key={member.chunk_id} value={index}>
            {index + 1}. {member.file_path}:{member.start_line}-{member.end_line}
          </option>
        ))}
      </select>
    </label>
  );
}

function CodePane({ member }) {
  if (!member) return null;
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-gray-800 bg-gray-950">
      <div className="border-b border-gray-800 px-3 py-2">
        <p className="break-all font-mono text-xs text-indigo-300">
          {member.file_path}:{member.start_line}-{member.end_line}
        </p>
      </div>
      <div className="max-h-96 overflow-auto">
        <SyntaxHighlighter
          language={getSyntaxLanguage(member.file_path)}
          style={vscDarkPlus}
          showLineNumbers
          startingLineNumber={member.start_line || 1}
          customStyle={{ margin: 0, borderRadius: 0, background: 'transparent', fontSize: '0.78rem', lineHeight: 1.55 }}
          lineNumberStyle={{ color: '#6b7280', minWidth: '3em' }}
        >
          {member.content || member.excerpt || ''}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

function DuplicationDetailModal({ cluster, repoId, token, onClose }) {
  const members = cluster?.members || [];
  const [leftIndex, setLeftIndex] = useState(0);
  const [rightIndex, setRightIndex] = useState(Math.min(1, Math.max(0, members.length - 1)));
  const [isRefactoring, setIsRefactoring] = useState(false);
  const [refactorText, setRefactorText] = useState('');
  const [refactorError, setRefactorError] = useState(null);

  useEffect(() => {
    setLeftIndex(0);
    setRightIndex(Math.min(1, Math.max(0, members.length - 1)));
    setRefactorText('');
    setRefactorError(null);
  }, [cluster?.id, members.length]);

  const askAi = useCallback(async () => {
    if (!cluster || !token || isRefactoring) return;
    setIsRefactoring(true);
    setRefactorText('');
    setRefactorError(null);

    try {
      const res = await fetch(apiUrl(`/api/review/${repoId}/duplication-refactor`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cluster }),
      });
      if (!res.ok || !res.body) throw new Error('Failed to start duplication refactor');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        events.forEach((eventText) => {
          const line = eventText.split('\n').find(line => line.startsWith('data: '));
          if (!line) return;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'chunk') setRefactorText(prev => prev + event.text);
            if (event.type === 'error') setRefactorError(event.message || 'Failed to generate refactor');
          } catch {
            // Ignore malformed partial SSE frames.
          }
        });
      }
    } catch (err) {
      setRefactorError(err.message || 'Failed to generate refactor');
    } finally {
      setIsRefactoring(false);
    }
  }, [cluster, isRefactoring, repoId, token]);

  return (
    <Modal isOpen={!!cluster} onClose={onClose} title="Duplicate Code Cluster" maxWidth="max-w-6xl">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={cluster?.severity === 'high' ? 'danger' : cluster?.severity === 'medium' ? 'warning' : 'subtle'}>
            {cluster?.severity || 'low'}
          </Badge>
          <Badge tone="subtle">{cluster?.member_count || 0} chunks</Badge>
          <Badge tone="subtle">{cluster?.total_lines || 0} lines</Badge>
          <Badge tone="subtle">{formatPercent(cluster?.similarity_min)}-{formatPercent(cluster?.similarity_max)} similar</Badge>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <MemberPicker label="Left pane" members={members} value={leftIndex} onChange={setLeftIndex} />
          <MemberPicker label="Right pane" members={members} value={rightIndex} onChange={setRightIndex} />
        </div>

        <div className="grid min-h-0 gap-4 lg:grid-cols-2">
          <CodePane member={members[leftIndex]} />
          <CodePane member={members[rightIndex]} />
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-200">AI refactor proposal</p>
              <p className="mt-1 text-xs text-gray-500">Generate a shared utility and replacement notes for this duplicate cluster.</p>
            </div>
            <Button onClick={askAi} disabled={isRefactoring} loading={isRefactoring} icon={Sparkles}>
              {isRefactoring ? 'Refactoring...' : 'Ask AI to extract shared utility'}
            </Button>
          </div>
          {refactorError && <p className="mt-3 text-sm text-red-400">{refactorError}</p>}
          {refactorText && (
            <div className="mt-4 whitespace-pre-wrap rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm leading-relaxed text-gray-200">
              {refactorText}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── IssuesPanel (main) ────────────────────────────────────────────────────────
export default function IssuesPanel({ nodes, issues, onNodeSelect, onOpenDependencies, onOpenFile, repoId }) {
  const { session } = useAuth();
  const accessToken = session?.access_token;

  const [localIssues, setLocalIssues] = useState(issues || []);
  const [duplicationClusters, setDuplicationClusters] = useState([]);
  const [selectedDuplicationCluster, setSelectedDuplicationCluster] = useState(null);
  const [filterText,  setFilterText]  = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [canMutateIssues, setCanMutateIssues] = useState(true);

  // Sync local state if the upstream issues prop changes
  useEffect(() => {
    if (issues && issues.length > 0) {
      setLocalIssues(issues);
    }
  }, [issues]);


  useEffect(() => {
    const fetchDuplication = async () => {
      if (!accessToken || !repoId) return;
      try {
        const res = await fetch(apiUrl(`/api/repos/${repoId}/duplication`), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error('Failed to fetch duplication clusters');
        const data = await res.json();
        setDuplicationClusters(data.clusters || []);
      } catch (err) {
        console.error('Failed to fetch duplication clusters', err);
        setDuplicationClusters([]);
      }
    };

    fetchDuplication();
  }, [repoId, accessToken]);

  useEffect(() => {
    const fetchStatus = async () => {
      if (!accessToken || !repoId) return;
      try {
        const res = await fetch(apiUrl(`/api/repos/${repoId}/status`), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error('Failed to fetch repo status');
        const data = await res.json();
        const coreReady = Boolean(data?.latest_job?.core_ready);
        const repoWorking = data?.status === 'pending' || data?.status === 'indexing';
        setCanMutateIssues(!repoWorking || coreReady);
      } catch {
        setCanMutateIssues(true);
      }
    };

    fetchStatus();
  }, [repoId, accessToken]);

  const nodeMap = useMemo(
    () => new Map((nodes || []).map(n => [n.file_path, n.id || n.file_path])),
    [nodes]
  );

  // Filter by file path or description text — debounced so useMemo only
  // fires after 200ms of typing silence, not on every single keystroke.
  const debouncedFilterText = useDebouncedValue(filterText, 200);
  const filteredIssues = useMemo(() => {
    if (!debouncedFilterText.trim()) return localIssues;
    const q = debouncedFilterText.toLowerCase();
    return localIssues.filter(issue =>
      issue.description?.toLowerCase().includes(q) ||
      issue.file_paths?.some(fp => fp.toLowerCase().includes(q))
    );
  }, [localIssues, debouncedFilterText]);

  const handleIssueClick = useCallback((issue) => {
    if (issue.type === 'vulnerable_dependency') {
      onOpenDependencies(issue);
      return;
    }
    const resolvedIds = issue.file_paths
      .map(path => nodeMap.get(path))
      .filter(Boolean);
    if (resolvedIds.length > 0) onNodeSelect(resolvedIds);
  }, [nodeMap, onNodeSelect, onOpenDependencies]);

  const handleSuppress = useCallback(async (e, issue) => {
    e.stopPropagation();
    if (!canMutateIssues) return;
    const ruleMatch = issue.description.match(/Rule ID: (.*?)\)/);
    if (!ruleMatch) return;
    const lineMatch = issue.description.match(/line (\d+)/);

    const payload = {
      file_path:   issue.file_paths[0],
      rule_id:     ruleMatch[1],
      line_number: lineMatch ? parseInt(lineMatch[1], 10) : 0,
    };
    try {
      const res = await fetch(apiUrl(`/api/analysis/${repoId}/issues/suppress`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to suppress issue');
      setLocalIssues(prev => prev.filter(i => i.id !== issue.id));
    } catch (err) {
      console.error('Failed to suppress issue', err);
    }
  }, [canMutateIssues, repoId, session]);

  const handleDisableSastRule = useCallback(async (e, issue) => {
    e.stopPropagation();
    if (!canMutateIssues) return;
    const ruleIdMatch = issue.description.match(/Rule ID: ([\w-]+)/);
    if (!ruleIdMatch) return;
    const ruleId = ruleIdMatch[1];
    try {
      const repoRes  = await fetch(apiUrl(`/api/repos/${repoId}/status`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const repoData = await repoRes.json();
      const current  = repoData.sast_disabled_rules || [];
      if (current.includes(ruleId)) return;

      const res = await fetch(apiUrl(`/api/repos/${repoId}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ sast_disabled_rules: [...current, ruleId] }),
      });
      if (!res.ok) throw new Error('Failed to disable rule');
      setLocalIssues(prev =>
        prev.filter(i => !(i.type === 'insecure_pattern' && i.description.includes(`Rule ID: ${ruleId}`)))
      );
    } catch (err) {
      console.error('Failed to disable SAST rule', err);
    }
  }, [canMutateIssues, repoId, session]);

  if ((!localIssues || localIssues.length === 0) && duplicationClusters.length === 0) {
    return (
      <>
        <div className="flex h-auto min-h-[30rem] flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/30 px-6 text-center xl:h-[calc(100vh-12rem)]">
          {isFetching ? (
            <div className="flex flex-col items-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent mb-3" />
              <p className="text-sm text-gray-400">Loading issues...</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-200">No issues detected</h3>
              <p className="mt-1 text-sm text-gray-500">No architectural, security, or duplication findings need attention.</p>
            </>
          )}
        </div>
        <DuplicationDetailModal
          cluster={selectedDuplicationCluster}
          repoId={repoId}
          token={accessToken}
          onClose={() => setSelectedDuplicationCluster(null)}
        />
      </>
    );
  }

  return (
    <div className="relative flex h-auto min-h-[30rem] flex-col overflow-auto rounded-xl bg-gray-950 p-1 xl:h-[calc(100vh-12rem)]">
      {/* Info banner with <code> instead of backticks */}
      <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 text-sm text-gray-400">
        This is the triage view — showing only actionable problems including vulnerable dependencies.
        Click a <code className="bg-gray-800 text-indigo-300 rounded px-1 py-0.5 text-xs font-mono">vulnerable_dependency</code> issue
        to jump to the <code className="bg-gray-800 text-indigo-300 rounded px-1 py-0.5 text-xs font-mono">Dependencies</code> tab
        with that package pre-filtered.
      </div>

      {!canMutateIssues && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 mb-4">
          Issue actions are temporarily disabled while the repository is re-indexing. They will re-enable once core indexing is ready.
        </div>
      )}

      {/* Search/filter input */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
        <input
          type="text"
          placeholder="Filter by file path or description…"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          className="w-full rounded-xl border border-gray-800 bg-gray-900 pl-9 pr-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition"
        />
      </div>

      {/* Grouped issues */}
      <div className="space-y-2">
        {GROUP_ORDER.map(({ type, label, Icon }) => {
          const groupIssues = filteredIssues.filter(i => i.type === type);
          if (groupIssues.length === 0) return null;
          return (
            <IssueGroup
              key={type}
              type={type}
              label={label}
              Icon={Icon}
              issues={groupIssues}
              nodeMap={nodeMap}
              onIssueClick={handleIssueClick}
              onSuppress={handleSuppress}
              onDisableRule={handleDisableSastRule}
              actionsDisabled={!canMutateIssues}
            />
          );
        })}

        <DuplicationSection
          clusters={duplicationClusters}
          onOpen={setSelectedDuplicationCluster}
        />

        {/* No filter results */}
        {filterText && filteredIssues.length === 0 && duplicationClusters.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <Search className="h-8 w-8 mb-3 opacity-30" />
            <p className="text-sm">No issues match &ldquo;{filterText}&rdquo;</p>
          </div>
        )}
      </div>
      <DuplicationDetailModal
        cluster={selectedDuplicationCluster}
        repoId={repoId}
        token={accessToken}
        onClose={() => setSelectedDuplicationCluster(null)}
      />
    </div>
  );
}
