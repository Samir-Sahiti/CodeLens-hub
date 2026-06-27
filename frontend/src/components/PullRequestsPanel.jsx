import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { formatDate } from '../lib/constants';
import { useToast } from './Toast';
import IssueCard from './IssueCard';
import ProposalPanel from './ProposalPanel';
import { Badge, Banner, Button, EmptyState, SegmentedControl, Select, Skeleton } from './ui/Primitives';
import { ArrowLeft, ExternalLink, GitBranch, RefreshCw } from './ui/Icons';

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const STATUS_TONE = {
  ready: 'success',
  analyzing: 'accent',
  failed: 'danger',
  stale: 'warning',
  not_analyzed: 'subtle',
};
const SEVERITY_CLASS = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-sky-500',
};

function shortSha(value) {
  return value ? String(value).slice(0, 7) : '-';
}

function countsTotal(counts = {}) {
  return SEVERITIES.reduce((sum, severity) => sum + Number(counts?.[severity] || 0), 0);
}

function statusLabel(status) {
  return status === 'not_analyzed' ? 'not analyzed' : status || 'not analyzed';
}

export function SeverityBreakdown({ counts = {} }) {
  const total = Math.max(1, countsTotal(counts));
  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-gray-800">
        {SEVERITIES.map((severity) => Number(counts[severity] || 0) > 0 && (
          <div key={severity} className={SEVERITY_CLASS[severity]} style={{ width: `${(Number(counts[severity] || 0) / total) * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-gray-400">
        {SEVERITIES.map((severity) => (
          <span key={severity} className="capitalize">{severity}: {Number(counts[severity] || 0)}</span>
        ))}
      </div>
    </div>
  );
}

function SeveritySummary({ counts = {}, hasReview = false }) {
  if (!hasReview) return <span className="text-gray-500">-</span>;

  const visibleCounts = SEVERITIES
    .map((severity) => ({ severity, count: Number(counts[severity] || 0) }))
    .filter((item) => item.count > 0);

  if (visibleCounts.length === 0) {
    return <Badge tone="success" className="w-fit">Clean</Badge>;
  }

  return (
    <span className="flex flex-wrap gap-1.5">
      {visibleCounts.map(({ severity, count }) => (
        <span
          key={severity}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold leading-none text-gray-950 ${SEVERITY_CLASS[severity]}`}
          title={`${severity}: ${count}`}
        >
          <span className="capitalize">{severity}</span>
          <span>{count}</span>
        </span>
      ))}
    </span>
  );
}

export function PRListItem({ pull, onSelect }) {
  const counts = pull.latest_review?.severity_counts || {};
  return (
    <button
      type="button"
      onClick={() => onSelect(pull)}
      className="grid w-full grid-cols-[4rem_minmax(14rem,1fr)_10rem_7rem_9rem_12rem_10rem] items-center gap-4 border-b border-gray-800/70 px-4 py-3 text-left text-sm transition-colors hover:bg-gray-900/70"
    >
      <span className="font-mono text-gray-400">#{pull.number}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-gray-100">{pull.title}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        {pull.author?.avatar_url && <img src={pull.author.avatar_url} alt="" className="h-6 w-6 rounded-full" />}
        <span className="truncate text-gray-400">{pull.author?.login || 'unknown'}</span>
      </span>
      <span className="font-mono text-xs text-gray-400">{shortSha(pull.head_sha)}</span>
      <Badge tone={STATUS_TONE[pull.review_status] || 'subtle'} className="w-fit capitalize">{statusLabel(pull.review_status)}</Badge>
      <span>
        <SeveritySummary counts={counts} hasReview={!!pull.latest_review} />
      </span>
      <span className="text-xs text-gray-500">{pull.latest_review?.updated_at ? formatDate(pull.latest_review.updated_at) : '-'}</span>
    </button>
  );
}

function groupFindings(findings = []) {
  const groups = [];
  for (const severity of SEVERITIES) {
    const byFile = new Map();
    for (const finding of findings.filter((item) => (item.severity || 'medium') === severity)) {
      const file = finding.file_path || 'No file';
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(finding);
    }
    if (byFile.size > 0) groups.push({ severity, files: [...byFile.entries()] });
  }
  return groups;
}

function normalizeFindingForCard(finding, reviewId, repoId) {
  return {
    ...finding,
    id: finding.id || `${finding.file_path || 'file'}:${finding.line_number || 0}:${finding.rule_id || 'rule'}`,
    file_paths: finding.file_path ? [finding.file_path] : [],
    description: finding.message || finding.description,
    is_pr_finding: true,
    pr_review_id: reviewId,
    proposalEndpoint: `/api/review/${repoId}/pr-findings/proposals`,
    proposalApplyBase: `/api/review/${repoId}/pr-findings/proposals`,
    proposalPayload: { review_id: reviewId, finding_id: finding.id, finding },
  };
}

export default function PullRequestsPanel({ repoId, repo, active, onRepoUpdated }) {
  const { session } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const reviewId = searchParams.get('review');
  const prNumber = searchParams.get('pr');
  const token = session?.access_token;

  const [stateFilter, setStateFilter] = useState('open');
  const [findingsFilter, setFindingsFilter] = useState('all');
  const [authorFilter, setAuthorFilter] = useState('');
  const [listData, setListData] = useState({ pr_review_enabled: true, pulls: [], authors: [] });
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState([]);
  // When a review id is present in the URL the detail fetch fires on mount, so
  // start in the loading state to avoid flashing undefined PR data first.
  const [detailLoading, setDetailLoading] = useState(Boolean(reviewId));
  const [isEnabling, setIsEnabling] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);
  const [runStatus, setRunStatus] = useState('');
  const [proposalIssue, setProposalIssue] = useState(null);

  const selectedPull = useMemo(() => (
    listData.pulls.find((pull) => String(pull.number) === String(prNumber)) || null
  ), [listData.pulls, prNumber]);

  const fetchPulls = useCallback(async () => {
    if (!token || !repoId) return;
    setListLoading(true);
    setListError(null);
    try {
      const qs = new URLSearchParams({ state: stateFilter, findings: findingsFilter });
      if (authorFilter) qs.set('author', authorFilter);
      const res = await fetch(apiUrl(`/api/repos/${repoId}/pulls?${qs.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load pull requests');
      setListData({
        pr_review_enabled: data.pr_review_enabled,
        pulls: data.pulls || [],
        authors: data.authors || [],
      });
    } catch (err) {
      setListError(err.message || 'Failed to load pull requests');
    } finally {
      setListLoading(false);
    }
  }, [authorFilter, findingsFilter, repoId, stateFilter, token]);

  const fetchReviewDetail = useCallback(async (id, { quiet = false } = {}) => {
    if (!id || !token) return;
    if (!quiet) setDetailLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/reviews/${id}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load PR review');
      setDetail(data);
      if (data.review?.pr_number) {
        const hist = await fetch(apiUrl(`/api/repos/${repoId}/pulls/${data.review.pr_number}/reviews`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (hist.ok) {
          const historyData = await hist.json();
          setHistory(historyData.reviews || []);
        }
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load PR review');
    } finally {
      if (!quiet) setDetailLoading(false);
    }
  }, [repoId, toast, token]);

  useEffect(() => {
    if (!active) return undefined;
    fetchPulls();
    if (reviewId) fetchReviewDetail(reviewId);
    const id = !reviewId ? setInterval(fetchPulls, 30_000) : null;
    return () => {
      if (id) clearInterval(id);
    };
  }, [active, fetchPulls, fetchReviewDetail, reviewId]);

  const selectPull = useCallback((pull) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'pulls');
    next.set('pr', String(pull.number));
    if (pull.latest_review?.id) next.set('review', pull.latest_review.id);
    else next.delete('review');
    setSearchParams(next, { replace: false });
  }, [searchParams, setSearchParams]);

  const backToList = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'pulls');
    next.delete('pr');
    next.delete('review');
    setSearchParams(next, { replace: false });
    setDetail(null);
    setHistory([]);
  }, [searchParams, setSearchParams]);

  const enableReviews = async () => {
    if (!token) return;
    setIsEnabling(true);
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pr_review_enabled: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to enable PR reviews');
      onRepoUpdated?.();
      setListData((prev) => ({ ...prev, pr_review_enabled: true }));
      await fetchPulls();
    } catch (err) {
      toast.error(err.message || 'Failed to enable PR reviews');
    } finally {
      setIsEnabling(false);
    }
  };

  const rerunReview = async (number) => {
    if (!number || !token || isRerunning) return;
    setIsRerunning(true);
    setRunStatus('Starting review...');
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/pulls/${number}/reviews`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start PR review');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let doneReviewId = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const eventText of events) {
          const line = eventText.split('\n').find((entry) => entry.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'analyzing_file') setRunStatus(`Analyzing ${event.file}`);
          if (event.type === 'summary') setRunStatus(`Found ${event.total_findings || 0} findings`);
          if (event.type === 'done') doneReviewId = event.review_id;
          if (event.type === 'error') throw new Error(event.message || 'PR review failed');
        }
      }
      await fetchPulls();
      if (doneReviewId) {
        const next = new URLSearchParams(searchParams);
        next.set('tab', 'pulls');
        next.set('pr', String(number));
        next.set('review', doneReviewId);
        setSearchParams(next, { replace: true });
        await fetchReviewDetail(doneReviewId);
      }
    } catch (err) {
      toast.error(err.message || 'PR review failed');
    } finally {
      setIsRerunning(false);
      setRunStatus('');
    }
  };

  const suppressFinding = async (_event, finding) => {
    try {
      const payload = {
        file_path: finding.file_path || finding.file_paths?.[0],
        rule_id: finding.rule_id || finding._meta?.rule_id,
        line_number: finding.line_number || finding._meta?.line_number || 0,
        type: finding.type,
      };
      const res = await fetch(apiUrl(`/api/analysis/${repoId}/issues/suppress`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to suppress finding');
      setDetail((prev) => {
        if (!prev?.review) return prev;
        const nextFindings = (prev.review.findings_json || []).filter((item) => item.id !== finding.id);
        const nextCounts = { critical: 0, high: 0, medium: 0, low: 0 };
        nextFindings.forEach((item) => {
          const severity = item.severity || 'medium';
          if (Object.prototype.hasOwnProperty.call(nextCounts, severity)) nextCounts[severity] += 1;
        });
        return {
          ...prev,
          review: {
            ...prev.review,
            findings_json: nextFindings,
            total_findings: nextFindings.length,
            severity_counts: nextCounts,
          },
        };
      });
      if (reviewId) fetchReviewDetail(reviewId, { quiet: true });
    } catch (err) {
      toast.error(err.message || 'Failed to suppress finding');
    }
  };

  if (listData.pr_review_enabled === false) {
    return (
      <EmptyState
        title="PR review isn't enabled for this repo."
        description="Enable PR review to browse CodeLens findings for pull requests."
        className="min-h-[30rem] py-24"
        actions={<Button onClick={enableReviews} loading={isEnabling}>Enable</Button>}
      />
    );
  }

  if (reviewId || prNumber) {
    const review = detail?.review;
    const pull = detail?.pull_request || selectedPull;
    const findings = review?.findings_json || [];
    const groups = groupFindings(findings);
    const counts = review?.severity_counts || selectedPull?.latest_review?.severity_counts || {};
    return (
      <div className="min-h-[30rem] space-y-5">
        <Button variant="ghost" icon={ArrowLeft} onClick={backToList}>Pull Requests</Button>

        {detailLoading && !detail ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 rounded-xl border border-gray-800 bg-gray-950/70 p-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-xl font-semibold text-white">{pull?.title || `PR #${prNumber}`}</h2>
                  <Badge tone={STATUS_TONE[review?.status || selectedPull?.review_status] || 'subtle'} className="capitalize">
                    {statusLabel(review?.status || selectedPull?.review_status)}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-500">
                  <span>head <code className="text-gray-300">{shortSha(review?.pr_head_sha || pull?.head_sha)}</code></span>
                  <span>base <code className="text-gray-300">{shortSha(review?.pr_base_sha || pull?.base_sha)}</code></span>
                  {pull?.html_url && (
                    <a className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200" href={pull.html_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3" />
                      GitHub
                    </a>
                  )}
                </div>
              </div>
              <Button icon={RefreshCw} loading={isRerunning} onClick={() => rerunReview(review?.pr_number || pull?.number || prNumber)}>
                {isRerunning ? 'Reviewing...' : 'Re-run review'}
              </Button>
            </div>

            {runStatus && <Banner tone="accent">{runStatus}</Banner>}
            {detail?.stale_index?.is_stale === true && (
              <Banner tone="warning">
                Repository index is stale for this PR. Indexed {shortSha(detail.stale_index.indexed_sha)}; PR head is {shortSha(detail.stale_index.pr_head_sha)}.
              </Banner>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <section className="rounded-xl border border-gray-800 bg-gray-950/70 p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-gray-500">Aggregate summary</h3>
                  {review?.github_review_url && (
                    <a href={review.github_review_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-indigo-300 hover:text-indigo-200">
                      <ExternalLink className="h-4 w-4" />
                      GitHub review
                    </a>
                  )}
                </div>
                <SeverityBreakdown counts={counts} />
                {review?.summary && <p className="mt-4 text-sm leading-relaxed text-gray-300">{review.summary}</p>}
              </section>

              <section className="rounded-xl border border-gray-800 bg-gray-950/70 p-5">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-gray-500">Review history</h3>
                <div className="space-y-2">
                  {history.length === 0 ? <p className="text-sm text-gray-500">No review history yet.</p> : history.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        const next = new URLSearchParams(searchParams);
                        next.set('review', item.id);
                        next.set('pr', String(item.pr_number || review?.pr_number || prNumber));
                        setSearchParams(next, { replace: false });
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-xs ${item.id === review?.id ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-100' : 'border-gray-800 bg-gray-900/50 text-gray-400 hover:bg-gray-800'}`}
                    >
                      <span className="block capitalize">{item.status}</span>
                      <span className="block">{shortSha(item.pr_head_sha)} · {formatDate(item.updated_at || item.created_at)}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>

            {(!review && selectedPull && !selectedPull.latest_review) ? (
              <EmptyState
                title="This PR has not been analyzed"
                description="Run a CodeLens PR review to see findings here."
                className="py-20"
                actions={<Button icon={GitBranch} loading={isRerunning} onClick={() => rerunReview(selectedPull.number)}>Re-run review</Button>}
              />
            ) : groups.length === 0 ? (
              <EmptyState title="No findings in this review" description="CodeLens did not find PR-specific issues for this review." className="py-20" />
            ) : (
              <div className="space-y-6">
                {groups.map((group) => (
                  <section key={group.severity}>
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-gray-500">{group.severity}</h3>
                    <div className="space-y-4">
                      {group.files.map(([file, fileFindings]) => (
                        <div key={`${group.severity}-${file}`}>
                          <p className="mb-2 break-all font-mono text-xs text-indigo-300">{file}</p>
                          <div className="grid gap-3">
                            {fileFindings.map((finding) => (
                              <IssueCard
                                key={finding.id}
                                issue={normalizeFindingForCard(finding, review?.id, repoId)}
                                type={finding.type || 'pr_review'}
                                onIssueClick={() => {}}
                                onProposeFix={setProposalIssue}
                                onSuppress={suppressFinding}
                                onViewGithub={() => {}}
                                suppressLabel="Suppress"
                                proposeLabel="Generate fix"
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}

            <ProposalPanel
              repoId={repoId}
              issue={proposalIssue}
              token={token}
              open={!!proposalIssue}
              onClose={() => setProposalIssue(null)}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-[30rem] overflow-hidden rounded-xl border border-gray-800 bg-gray-950">
      <div className="flex flex-col gap-3 border-b border-gray-800 p-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Pull Requests</h2>
          <p className="mt-1 text-sm text-gray-500">Recent PR reviews for {repo?.full_name || repo?.name || 'this repo'}.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <SegmentedControl
            label="State"
            value={stateFilter}
            onChange={setStateFilter}
            options={[{ label: 'Open', value: 'open' }, { label: 'All', value: 'all' }]}
          />
          <SegmentedControl
            label="Findings"
            value={findingsFilter}
            onChange={setFindingsFilter}
            options={[{ label: 'All', value: 'all' }, { label: 'Has findings', value: 'has_findings' }, { label: 'Clean', value: 'clean' }]}
          />
          <Select label="Author" value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)} inputClassName="min-w-36">
            <option value="">All authors</option>
            {listData.authors.map((author) => <option key={author} value={author}>{author}</option>)}
          </Select>
          <Button variant="outline" icon={RefreshCw} onClick={fetchPulls} loading={listLoading}>Refresh</Button>
        </div>
      </div>

      {listError && <Banner tone="danger" className="m-4">{listError}</Banner>}
      {listLoading && listData.pulls.length === 0 ? (
        <div className="space-y-3 p-4">
          {[...Array(5)].map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
        </div>
      ) : listData.pulls.length === 0 ? (
        <EmptyState title="No pull requests found" description="No PRs match the current filters." className="py-24" />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[72rem]">
            <div className="grid grid-cols-[4rem_minmax(14rem,1fr)_10rem_7rem_9rem_12rem_10rem] gap-4 border-b border-gray-800 bg-gray-900/80 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
              <span>#</span>
              <span>Title</span>
              <span>Author</span>
              <span>Head</span>
              <span>Status</span>
              <span>Severity</span>
              <span>Last analyzed</span>
            </div>
            {listData.pulls.map((pull) => (
              <PRListItem key={pull.number} pull={pull} onSelect={selectPull} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
