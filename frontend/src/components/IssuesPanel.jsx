import { useMemo } from 'react';

export default function IssuesPanel({ nodes, issues, onNodeSelect }) {
  const nodeMap = useMemo(
    () => new Map(nodes.map(n => [n.file_path, n.id || n.file_path])),
    [nodes]
  );

  if (!issues || issues.length === 0) {
    return (
      <div className="flex h-[40rem] flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/30">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 mb-4">
          <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-200">No issues detected — your codebase looks healthy 🎉</h3>
      </div>
    );
  }

  const GROUP_ORDER = [
    { type: 'circular_dependency', label: 'Circular Dependencies' },
    { type: 'god_file', label: 'God Files' },
    { type: 'high_coupling', label: 'High Coupling' },
    { type: 'dead_code', label: 'Dead Code' },
  ];

  const getBadgeStyles = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'high': return 'bg-red-500/20 text-red-400 ring-1 ring-inset ring-red-500/30';
      case 'medium': return 'bg-orange-500/20 text-orange-400 ring-1 ring-inset ring-orange-500/30';
      case 'low': return 'bg-yellow-500/20 text-yellow-400 ring-1 ring-inset ring-yellow-500/30';
      default: return 'bg-gray-500/20 text-gray-400 ring-1 ring-inset ring-gray-500/30';
    }
  };

  const handleIssueClick = (issue) => {
    const resolvedIds = issue.file_paths
      .map(path => nodeMap.get(path))
      .filter(Boolean);

    if (resolvedIds.length > 0) {
      onNodeSelect(resolvedIds);
    }
  };

  return (
    <div className="flex flex-col h-[40rem] overflow-auto bg-gray-950 rounded-xl space-y-8 p-1 relative">
      {GROUP_ORDER.map(({ type, label }) => {
        const groupIssues = issues.filter(i => i.type === type);
        if (groupIssues.length === 0) return null;

        return (
          <div key={type} className="mb-8 last:mb-0">
            <h2 className="text-lg font-semibold text-gray-200 border-b border-gray-800 pb-2 mb-4 sticky top-0 bg-gray-950 z-10">
              {label} <span className="text-gray-500 text-sm ml-2 font-normal">({groupIssues.length})</span>
            </h2>
            <div className="grid gap-4">
              {groupIssues.map((issue, idx) => (
                <div
                  key={issue.id || `${type}-${idx}`}
                  onClick={() => handleIssueClick(issue)}
                  className="flex flex-col bg-gray-900/50 hover:bg-gray-800/80 border border-gray-800 hover:border-gray-700 rounded-lg p-5 cursor-pointer transition-all duration-200"
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wider ${getBadgeStyles(issue.severity)}`}>
                      {issue.severity || 'UNKNOWN'}
                    </span>
                  </div>
                  <p className="text-gray-300 text-sm mb-4 leading-relaxed">
                    {issue.description || 'No description available.'}
                  </p>
                  <div className="mt-auto bg-gray-950/50 rounded-md p-3 border border-gray-800 break-words">
                    <span className="font-mono text-xs text-gray-400 leading-loose">
                      {issue.file_paths.join(' → ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

