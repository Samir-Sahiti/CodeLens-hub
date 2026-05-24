import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SyntaxHighlighter from '../lib/syntaxHighlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { apiUrl } from '../lib/api';
import { Badge, Banner, Button, Skeleton, cx } from './ui/Primitives';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  GitBranch,
  RefreshCw,
  Sparkles,
  StopCircle,
  Trash2,
  X,
} from './ui/Icons';

const EMPTY_PROPOSAL = {
  id: null,
  status: null,
  summary: '',
  rationale: '',
  changes: [],
  risks: [],
  branch_name: null,
  pr_url: null,
  prompt_tokens: 0,
  completion_tokens: 0,
};

function normalizeProposal(raw = {}) {
  const proposal = raw.proposal_json && typeof raw.proposal_json === 'object'
    ? { ...raw.proposal_json, id: raw.id, status: raw.status }
    : raw;

  return {
    id: proposal.id || proposal.proposal_id || raw.id || null,
    status: proposal.status || raw.status || null,
    summary: proposal.summary || '',
    rationale: proposal.rationale || '',
    changes: Array.isArray(proposal.changes) ? proposal.changes : [],
    risks: Array.isArray(proposal.risks) ? proposal.risks : [],
    branch_name: proposal.branch_name || raw.branch_name || null,
    pr_url: proposal.pr_url || raw.pr_url || null,
    prompt_tokens: Number(proposal.prompt_tokens || raw.prompt_tokens || 0),
    completion_tokens: Number(proposal.completion_tokens || raw.completion_tokens || 0),
  };
}

function mergeProposal(current, incoming) {
  const next = normalizeProposal(incoming);
  return {
    id: next.id || current.id,
    status: next.status || current.status,
    summary: next.summary || current.summary,
    rationale: next.rationale || current.rationale,
    changes: next.changes.length ? next.changes : current.changes,
    risks: next.risks.length ? next.risks : current.risks,
    branch_name: next.branch_name || current.branch_name,
    pr_url: next.pr_url || current.pr_url,
    prompt_tokens: next.prompt_tokens || current.prompt_tokens,
    completion_tokens: next.completion_tokens || current.completion_tokens,
  };
}

function getPrimaryPath(issue) {
  return issue?.file_paths?.[0] || 'Unknown file';
}

function getLineClass(line = '') {
  if (line.startsWith('+++') || line.startsWith('---')) return 'block bg-surface-800/70 text-accent-soft';
  if (line.startsWith('@@')) return 'block bg-accent/10 text-accent-soft';
  if (line.startsWith('+')) return 'block bg-emerald-500/10 text-emerald-200';
  if (line.startsWith('-')) return 'block bg-red-500/10 text-red-200';
  return 'block text-surface-400';
}

function Section({ title, children, emptyText }) {
  const isEmpty = children === null || children === undefined || children === '';
  return (
    <section className="rounded-lg border border-surface-800 bg-surface-950/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">{title}</p>
      <div className="mt-3 text-sm leading-relaxed text-gray-200">
        {isEmpty ? <p className="text-gray-500">{emptyText}</p> : children}
      </div>
    </section>
  );
}

function ProposalSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading proposal">
      <div className="rounded-lg border border-surface-800 bg-surface-950/70 p-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-4 h-3 w-11/12" />
        <Skeleton className="mt-2 h-3 w-9/12" />
      </div>
      <div className="rounded-lg border border-surface-800 bg-surface-950/70 p-4">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-4 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-10/12" />
      </div>
      <div className="rounded-lg border border-surface-800 bg-surface-950/70 p-4">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
      <div className="rounded-lg border border-surface-800 bg-surface-950/70 p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-4 h-3 w-8/12" />
      </div>
    </div>
  );
}

function DiffBlock({ change }) {
  const diff = change?.diff || '';
  return (
    <div className="overflow-hidden rounded-lg border border-surface-800 bg-surface-950">
      <div className="border-b border-surface-800 px-3 py-2">
        <p className="break-all font-mono text-xs text-accent-soft">{change?.file_path || 'Unknown file'}</p>
      </div>
      <div className="max-h-[45vh] overflow-auto">
        <SyntaxHighlighter
          language="unified-diff"
          style={vscDarkPlus}
          wrapLines
          lineProps={(lineNumber) => {
            const line = diff.split('\n')[lineNumber - 1] || '';
            return { className: getLineClass(line) };
          }}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            background: 'transparent',
            fontSize: '0.76rem',
            lineHeight: 1.55,
            minWidth: '100%',
          }}
        >
          {diff || 'No diff available.'}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

export default function ProposalPanel({ repoId, issue, token, open, onClose, onApplied }) {
  const [proposal, setProposal] = useState(EMPTY_PROPOSAL);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copyState, setCopyState] = useState('idle');
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const abortRef = useRef(null);
  const panelRef = useRef(null);
  const closeButtonRef = useRef(null);

  const proposalEndpoint = useMemo(() => (
    repoId && issue?.id ? `/api/review/${repoId}/issues/${issue.id}/proposals` : null
  ), [repoId, issue?.id]);

  const allDiffs = useMemo(() => (
    (proposal.changes || []).map((change) => change.diff).filter(Boolean).join('\n\n')
  ), [proposal.changes]);

  const hasContent = Boolean(
    proposal.summary || proposal.rationale || proposal.changes.length || proposal.risks.length
  );
  const isStale = proposal.status === 'stale';
  const isApplied = proposal.status === 'applied';
  const canMutate = Boolean(proposal.id) && !isStreaming && !isApplying;
  const totalTokens = (proposal.prompt_tokens || 0) + (proposal.completion_tokens || 0);

  const abortActiveStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const handleEvent = useCallback((event) => {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'summary_delta') {
      setProposal((prev) => ({ ...prev, summary: prev.summary + (event.text || event.delta || '') }));
    } else if (event.type === 'rationale_delta') {
      setProposal((prev) => ({ ...prev, rationale: prev.rationale + (event.text || event.delta || '') }));
    } else if (event.type === 'change') {
      const change = event.change || {
        file_path: event.file_path,
        diff: event.diff,
      };
      if (!change.file_path && !change.diff) return;
      setProposal((prev) => {
        const index = prev.changes.findIndex((item) => item.file_path === change.file_path);
        if (index === -1) return { ...prev, changes: [...prev.changes, change] };
        const changes = [...prev.changes];
        changes[index] = { ...changes[index], ...change };
        return { ...prev, changes };
      });
    } else if (event.type === 'risk') {
      const risk = event.risk || event.text;
      if (risk) setProposal((prev) => ({ ...prev, risks: [...prev.risks, risk] }));
    } else if (event.type === 'done') {
      setProposal((prev) => {
        const merged = event.proposal ? mergeProposal(prev, event.proposal) : prev;
        return {
          ...merged,
          id: event.proposal_id || merged.id,
          status: event.status || merged.status || 'pending',
          prompt_tokens: Number(event.prompt_tokens || merged.prompt_tokens || 0),
          completion_tokens: Number(event.completion_tokens || merged.completion_tokens || 0),
        };
      });
      setIsStreaming(false);
    } else if (event.type === 'error') {
      setError(event.message || 'Failed to generate proposal.');
      setIsStreaming(false);
    } else if (event.type === 'proposal' && event.proposal) {
      setProposal(normalizeProposal(event.proposal));
      setIsStreaming(false);
    }
  }, []);

  const readSse = useCallback(async (res) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const eventText of events) {
        const line = eventText.split('\n').find((row) => row.startsWith('data: '));
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line.slice(6)));
        } catch {
          // Ignore malformed partial SSE frames.
        }
      }
    }
  }, [handleEvent]);

  const loadProposal = useCallback(async ({ regenerate = false } = {}) => {
    if (!proposalEndpoint || !token) return;
    abortActiveStream();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setCopyState('idle');
    setIsLoading(true);
    setIsStreaming(false);
    if (regenerate) setProposal(EMPTY_PROPOSAL);

    try {
      const res = await fetch(apiUrl(`${proposalEndpoint}${regenerate ? '?regenerate=true' : ''}`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }

      const contentType = res.headers?.get?.('Content-Type') || res.headers?.get?.('content-type') || '';
      if (contentType.includes('application/json') || !res.body) {
        const data = await res.json();
        const nextProposal = normalizeProposal(data.proposal || data);
        setProposal(nextProposal);
        setIsStreaming(false);
        return;
      }

      setIsStreaming(true);
      await readSse(res);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Failed to load proposal.');
      }
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [abortActiveStream, proposalEndpoint, readSse, token]);

  useEffect(() => {
    if (!open || !issue) return undefined;
    setProposal(EMPTY_PROPOSAL);
    loadProposal();
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => abortActiveStream();
  }, [abortActiveStream, issue, loadProposal, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        abortActiveStream();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(panelRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [abortActiveStream, onClose, open]);

  const handleCopyDiff = async () => {
    if (!allDiffs) return;
    await navigator.clipboard.writeText(allDiffs);
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 1600);
  };

  const handleDiscard = async () => {
    if (!proposalEndpoint || !proposal.id || !token || isDiscarding) return;
    setIsDiscarding(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`${proposalEndpoint}/${proposal.id}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 'discarded' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to discard proposal.');
      }
      onClose?.();
    } catch (err) {
      setError(err.message || 'Failed to discard proposal.');
    } finally {
      setIsDiscarding(false);
    }
  };

  const handleApply = async () => {
    if (!repoId || !proposal.id || !token || isApplying) return;
    setIsApplying(true);
    setError(null);
    try {
      const res = await fetch(apiUrl(`/api/review/${repoId}/proposals/${proposal.id}/apply`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Server error ${res.status}`);
      }
      setProposal((prev) => ({
        ...prev,
        status: 'applied',
        branch_name: data.branch_name || prev.branch_name,
        pr_url: data.pr_url || prev.pr_url,
      }));
      onApplied?.({
        proposalId: proposal.id,
        issueId: issue?.id,
        branch_name: data.branch_name,
        pr_url: data.pr_url,
      });
    } catch (err) {
      setError(err.message || 'Failed to open the pull request.');
    } finally {
      setIsApplying(false);
    }
  };

  if (!open || !issue) return null;

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-panel-title"
      className={cx(
        'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-surface-800 bg-surface-900 shadow-2xl shadow-black/40',
        'transition-transform duration-200 ease-out sm:max-w-xl xl:max-w-2xl',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      <div className="shrink-0 border-b border-surface-800 bg-surface-900/95 px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone="accent">{issue.type || 'issue'}</Badge>
              {proposal.status && <Badge tone={isStale ? 'warning' : 'subtle'}>{proposal.status}</Badge>}
            </div>
            <h2 id="proposal-panel-title" className="text-base font-semibold text-white">Refactor proposal</h2>
            <p className="mt-1 break-all font-mono text-xs text-accent-soft">{getPrimaryPath(issue)}</p>
            {proposal.id && totalTokens > 0 && (
              <p className="mt-1 text-xs text-gray-500">{totalTokens.toLocaleString()} tokens</p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => { abortActiveStream(); onClose?.(); }}
            aria-label="Close proposal panel"
            className="rounded-lg border border-surface-700 bg-surface-800 p-2 text-surface-300 transition hover:bg-surface-700 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="space-y-4">
          {isStale && (
            <Banner tone="warning" icon={AlertTriangle} className="items-center">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p>This file has changed since this proposal was generated</p>
                <Button size="sm" variant="outline" icon={RefreshCw} onClick={() => loadProposal({ regenerate: true })}>
                  Regenerate
                </Button>
              </div>
            </Banner>
          )}

          {isApplied && proposal.pr_url && (
            <Banner tone="success" icon={CheckCircle2} className="items-center">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">Draft PR opened on GitHub</p>
                  {proposal.branch_name && (
                    <p className="mt-0.5 break-all font-mono text-xs opacity-80">{proposal.branch_name}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  icon={ExternalLink}
                  as="a"
                  href={proposal.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View PR
                </Button>
              </div>
            </Banner>
          )}

          {error && (
            <Banner tone="danger">{error}</Banner>
          )}

          {isLoading && !hasContent ? (
            <ProposalSkeleton />
          ) : (
            <>
              <Section title="Summary" emptyText={isStreaming ? 'Writing summary...' : 'No summary available.'}>
                {proposal.summary && <p className="whitespace-pre-wrap">{proposal.summary}</p>}
              </Section>

              <Section title="Rationale" emptyText={isStreaming ? 'Writing rationale...' : 'No rationale available.'}>
                {proposal.rationale && <p className="whitespace-pre-wrap">{proposal.rationale}</p>}
              </Section>

              <section className="rounded-lg border border-surface-800 bg-surface-950/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Changes</p>
                <div className="mt-3 space-y-3">
                  {proposal.changes.length > 0
                    ? proposal.changes.map((change, index) => (
                      <DiffBlock key={`${change.file_path || 'change'}-${index}`} change={change} />
                    ))
                    : <p className="text-sm text-gray-500">{isStreaming ? 'Preparing diffs...' : 'No changes available.'}</p>
                  }
                </div>
              </section>

              <Section title="Risks" emptyText={isStreaming ? 'Identifying risks...' : 'No risks listed.'}>
                {proposal.risks.length > 0 && (
                  <ul className="list-disc space-y-2 pl-5">
                    {proposal.risks.map((risk, index) => (
                      <li key={`${risk}-${index}`}>{risk}</li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-surface-800 bg-surface-900/95 px-4 py-3 sm:px-5">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {isStreaming ? (
            <Button
              variant="secondary"
              icon={StopCircle}
              onClick={() => {
                abortActiveStream();
                setIsStreaming(false);
                setIsLoading(false);
              }}
            >
              Cancel
            </Button>
          ) : isApplied ? (
            <Button variant="secondary" icon={copyState === 'copied' ? Check : Copy} disabled={!allDiffs} onClick={handleCopyDiff}>
              {copyState === 'copied' ? 'Copied' : 'Copy diff'}
            </Button>
          ) : (
            <>
              <Button variant="danger" icon={Trash2} disabled={!canMutate || isDiscarding} loading={isDiscarding} onClick={handleDiscard}>
                Discard
              </Button>
              <Button variant="secondary" icon={RefreshCw} disabled={!canMutate} onClick={() => loadProposal({ regenerate: true })}>
                Regenerate
              </Button>
              <Button variant="secondary" icon={copyState === 'copied' ? Check : Copy} disabled={!allDiffs || isStreaming} onClick={handleCopyDiff}>
                {copyState === 'copied' ? 'Copied' : 'Copy diff'}
              </Button>
              <Button
                variant="primary"
                icon={GitBranch}
                disabled={!canMutate || isStale}
                loading={isApplying}
                onClick={handleApply}
              >
                {isApplying ? 'Opening PR…' : 'Apply via PR'}
              </Button>
            </>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          {isStreaming && <Sparkles className="h-3.5 w-3.5 text-accent-soft" />}
          <span>{isStreaming ? 'Streaming proposal...' : 'Press Escape to close'}</span>
        </div>
      </div>
    </aside>
  );
}
