import { memo } from 'react';
import { ExternalLink, GitBranch, Sparkles } from './ui/Icons';

const TYPE_LABELS = {
  vulnerable_dependency: 'Vulnerable Dependencies',
  hardcoded_secret: 'Hardcoded Secrets',
  missing_auth: 'Potentially Unauthenticated Routes',
  insecure_pattern: 'Insecure Code Patterns',
  circular_dependency: 'Circular Dependencies',
  god_file: 'God Files',
  high_coupling: 'High Coupling',
  dead_code: 'Dead Code',
  refactoring_candidate: 'Refactoring Candidates',
};

export function getBadgeStyles(severity) {
  switch (severity?.toLowerCase()) {
    case 'critical': return 'bg-red-600/25 text-red-200 ring-1 ring-inset ring-red-500/40';
    case 'high':    return 'bg-red-500/20 text-red-400 ring-1 ring-inset ring-red-500/30';
    case 'medium':  return 'bg-orange-500/20 text-orange-400 ring-1 ring-inset ring-orange-500/30';
    case 'low':     return 'bg-yellow-500/20 text-yellow-400 ring-1 ring-inset ring-yellow-500/30';
    default:        return 'bg-gray-500/20 text-gray-400 ring-1 ring-inset ring-gray-500/30';
  }
}

function normalizeIssue(issue = {}) {
  const filePaths = Array.isArray(issue.file_paths)
    ? issue.file_paths
    : issue.file_path
      ? [issue.file_path]
      : [];
  const line = issue.line_number || issue._meta?.line_number || null;
  return {
    ...issue,
    file_paths: filePaths,
    description: issue.description || issue.message || 'No description available.',
    rule_id: issue.rule_id || issue._meta?.rule_id || null,
    line_number: line,
  };
}

const IssueCard = memo(function IssueCard({
  issue,
  type,
  onIssueClick = () => {},
  onSuppress,
  onDisableRule,
  onProposeFix,
  onViewGithub,
  actionsDisabled,
  appliedProposal,
  suppressLabel,
  proposeLabel,
}) {
  const normalized = normalizeIssue(issue);
  const hasPrOpen = appliedProposal?.status === 'applied' && appliedProposal?.pr_url;
  const canSuppress = typeof onSuppress === 'function' && (
    suppressLabel || type === 'hardcoded_secret' || type === 'missing_auth' || issue?.is_pr_finding
  );
  const resolvedSuppressLabel = suppressLabel
    || (type === 'missing_auth' ? 'Mark as intentionally public' : 'Mark as false positive');
  const riskScore = Number(normalized.risk_score);
  const hasRisk = Number.isFinite(riskScore);
  const riskTitle = `severity_weight x blast_factor x churn_factor`
    + (normalized.severity_weight || normalized.blast_factor || normalized.churn_factor
      ? ` = ${normalized.severity_weight ?? '?'} x ${normalized.blast_factor ?? '?'} x ${normalized.churn_factor ?? '?'}`
      : '');

  return (
    <div
      onClick={() => onIssueClick(normalized)}
      className="flex flex-col bg-gray-900/50 hover:bg-gray-800/80 border border-gray-800 hover:border-gray-700 rounded-xl p-5 cursor-pointer transition-all duration-200 hover:-translate-y-px hover:shadow-lg group"
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wider ${getBadgeStyles(normalized.severity)}`}>
            {normalized.severity || 'UNKNOWN'}
          </span>
          {TYPE_LABELS[normalized.type || type] && (
            <span className="inline-flex items-center rounded-md border border-gray-800 bg-gray-950/70 px-2 py-1 text-xs font-medium text-gray-400">
              {TYPE_LABELS[normalized.type || type]}
            </span>
          )}
          {normalized.rule_id && (
            <span className="inline-flex items-center rounded-md border border-gray-800 bg-gray-950/70 px-2 py-1 font-mono text-xs text-gray-400">
              {normalized.rule_id}
            </span>
          )}
          {hasRisk && (
            <span
              title={riskTitle}
              className="inline-flex items-center rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-xs font-medium text-accent-soft"
            >
              Risk {riskScore.toFixed(1)}
            </span>
          )}
          {hasPrOpen && (
            <a
              href={appliedProposal.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 hover:bg-emerald-500/20 transition-colors"
              title="View the draft PR opened from a CodeLens proposal"
            >
              <GitBranch className="h-3 w-3" />
              PR opened
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {onProposeFix && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onProposeFix(normalized); }}
              disabled={actionsDisabled}
              className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {proposeLabel || (hasPrOpen ? 'Open proposal' : 'Propose fix')}
            </button>
          )}

          {canSuppress && (
            <button
              onClick={(e) => { e.stopPropagation(); onSuppress(e, normalized); }}
              disabled={actionsDisabled}
              className="text-xs text-gray-500 hover:text-gray-200 underline transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resolvedSuppressLabel}
            </button>
          )}

          {type === 'insecure_pattern' && onDisableRule && (
            <button
              onClick={(e) => { e.stopPropagation(); onDisableRule(e, normalized); }}
              disabled={actionsDisabled}
              className="text-xs text-gray-500 hover:text-gray-200 underline transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              Disable this rule
            </button>
          )}

          {onViewGithub && normalized.github_url && (
            <a
              href={normalized.github_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs text-gray-400 underline transition-colors hover:text-gray-100"
            >
              <ExternalLink className="h-3 w-3" />
              View on GitHub
            </a>
          )}
        </div>
      </div>

      <p className="text-gray-300 text-sm mb-4 leading-relaxed whitespace-pre-wrap">
        {normalized.description}
      </p>

      <div className="mt-auto flex flex-wrap gap-x-2 gap-y-1 rounded-lg border border-gray-800 bg-gray-950/50 p-3">
        {normalized.file_paths.length > 0 ? normalized.file_paths.map((fp) => (
          <span key={fp} className="flex items-center gap-1.5">
            <button
              onClick={(e) => e.stopPropagation()}
              title={fp}
              className="font-mono text-xs text-gray-400 leading-loose break-all text-left hover:text-indigo-300 transition-colors cursor-pointer"
            >
              {fp}{normalized.line_number ? `:${normalized.line_number}` : ''}
            </button>
          </span>
        )) : (
          <span className="font-mono text-xs text-gray-500">No file location</span>
        )}
      </div>
    </div>
  );
});

export default IssueCard;
