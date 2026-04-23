import { useMemo, useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';

export default function IssuesPanel({ nodes, issues, onNodeSelect, repoId }) {
  const { session } = useAuth();
  // Local state to hide suppressed issues instantly without full page reload
  const [localIssues, setLocalIssues] = useState(issues || []);

  // Sync local state if the upstream issues prop changes
  useEffect(() => {
    setLocalIssues(issues || []);
  }, [issues]);

  const nodeMap = useMemo(
    () => new Map((nodes || []).map(n => [n.file_path, n.id || n.file_path])),
    [nodes]
  );

  if (!localIssues || localIssues.length === 0) {
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
<<<<<<< HEAD
    { type: 'hardcoded_secret',     label: 'Hardcoded Secrets',         icon: '🔒' },
    { type: 'vulnerable_dependency', label: 'Vulnerable Dependencies',   icon: '🛡️' },
    { type: 'insecure_pattern',     label: 'Insecure Code Patterns',     icon: '⚠️' },
    { type: 'circular_dependency',  label: 'Circular Dependencies',      icon: '🔄' },
    { type: 'god_file',             label: 'God Files',                  icon: '⚡' },
    { type: 'high_coupling',        label: 'High Coupling',              icon: '🔗' },
    { type: 'dead_code',            label: 'Dead Code',                  icon: '💀' },
=======
    { type: 'vulnerable_dependency', label: 'Vulnerable Dependencies' },
    { type: 'hardcoded_secret', label: 'Hardcoded Secrets' },
    { type: 'insecure_pattern', label: 'Insecure Code Patterns' },
    { type: 'circular_dependency', label: 'Circular Dependencies' },
    { type: 'god_file', label: 'God Files' },
    { type: 'high_coupling', label: 'High Coupling' },
    { type: 'dead_code', label: 'Dead Code' },
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
  ];

  const getBadgeStyles = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'high':   return 'bg-red-500/20 text-red-400 ring-1 ring-inset ring-red-500/30';
      case 'medium': return 'bg-orange-500/20 text-orange-400 ring-1 ring-inset ring-orange-500/30';
      case 'low':    return 'bg-yellow-500/20 text-yellow-400 ring-1 ring-inset ring-yellow-500/30';
      default:       return 'bg-gray-500/20 text-gray-400 ring-1 ring-inset ring-gray-500/30';
    }
  };

  const handleIssueClick = (issue) => {
    // Vuln issues reference manifest files — not graph nodes; skip graph nav for them
    if (issue.type === 'vulnerable_dependency') return;

    const resolvedIds = issue.file_paths
      .map(path => nodeMap.get(path))
      .filter(Boolean);

    if (resolvedIds.length > 0) {
      onNodeSelect(resolvedIds);
    }
  };

  const handleSuppress = async (e, issue) => {
    e.stopPropagation();

    const ruleMatch = issue.description.match(/Rule ID: (.*?)\)/);
    const lineMatch = issue.description.match(/line (\d+)/);

    if (!ruleMatch || !lineMatch) {
      console.error('Could not parse rule_id or line_number from issue description.');
      return;
    }

    const payload = {
      file_path:   issue.file_paths[0],
      rule_id:     ruleMatch[1],
      line_number: parseInt(lineMatch[1], 10),
    };

    try {
<<<<<<< HEAD
      const response = await fetch(`/api/repos/${repoId}/issues/suppress`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
=======
      const response = await fetch(apiUrl(`/api/analysis/${repoId}/issues/suppress`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload)
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
      });

      if (!response.ok) throw new Error('Failed to suppress issue');

      setLocalIssues(prev => prev.filter(i => i.id !== issue.id));
    } catch (err) {
      console.error('Failed to suppress issue', err);
    }
  };

  const handleDisableSastRule = async (e, issue) => {
    e.stopPropagation();

    const ruleIdMatch = issue.description.match(/Rule ID: ([\w-]+)/);
    if (!ruleIdMatch) {
      console.error('Could not parse rule_id from insecure_pattern description.');
      return;
    }

    const ruleId = ruleIdMatch[1];

    try {
<<<<<<< HEAD
      const repoRes = await fetch(`/api/repos/${repoId}/status`);
=======
      // Fetch current disabled rules first, then append
      const repoRes = await fetch(apiUrl(`/api/repos/${repoId}/status`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
      const repoData = await repoRes.json();
      const currentDisabled = repoData.sast_disabled_rules || [];

      if (currentDisabled.includes(ruleId)) return;

<<<<<<< HEAD
      const response = await fetch(`/api/repos/${repoId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sast_disabled_rules: [...currentDisabled, ruleId] }),
=======
      const response = await fetch(apiUrl(`/api/repos/${repoId}`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ sast_disabled_rules: [...currentDisabled, ruleId] })
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
      });

      if (!response.ok) throw new Error('Failed to disable rule');

      setLocalIssues(prev =>
        prev.filter(i => !(i.type === 'insecure_pattern' && i.description.includes(`Rule ID: ${ruleId}`)))
      );
    } catch (err) {
      console.error('Failed to disable SAST rule', err);
    }
  };

  // ── Vulnerable dependency card ─────────────────────────────────────────────
  const VulnIssueCard = ({ issue, idx }) => {
    const [expanded, setExpanded] = useState(false);
    const descParts  = issue.description || '';
    const cveMatch   = descParts.match(/^([^\s—]+)/);
    const cveId      = cveMatch ? cveMatch[1] : 'Advisory';
    const advisoryM  = descParts.match(/Advisory:\s*(https:\/\/\S+)/);
    const advisoryUrl = advisoryM ? advisoryM[1].replace(/\)$/, '') : null;
    const fixedM     = descParts.match(/Fixed in ([^\s.]+)\./);
    const fixedVer   = fixedM ? fixedM[1] : null;
    const manifestPath = (issue.file_paths || [])[0] || '';

    return (
      <div
        key={issue.id || `vuln-${idx}`}
        className="flex flex-col bg-gray-900/50 border border-gray-800 hover:border-gray-700 rounded-lg overflow-hidden transition-all duration-200"
      >
        <div
          className="flex items-start gap-3 p-5 cursor-pointer hover:bg-gray-800/40"
          onClick={() => setExpanded(e => !e)}
        >
          <span className={`mt-0.5 inline-flex items-center rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wider shrink-0 ${getBadgeStyles(issue.severity)}`}>
            {issue.severity}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-white font-semibold">{cveId}</span>
            </div>
            <p className="font-mono text-xs text-gray-500 mt-1 truncate">{manifestPath}</p>
          </div>
          <svg
            className={`w-4 h-4 text-gray-500 shrink-0 transition-transform mt-1 ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {expanded && (
          <div className="px-5 pb-4 border-t border-gray-800 pt-3 space-y-3">
            <p className="text-sm text-gray-300 leading-relaxed">{descParts}</p>
            <div className="flex flex-wrap gap-2">
              {fixedVer && (
                <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs text-green-300">
                  ✓ Fix: upgrade to <span className="font-mono font-semibold">{fixedVer}</span>
                </div>
              )}
              {!fixedVer && (
                <div className="rounded-md border border-gray-700 bg-gray-800/50 px-3 py-1.5 text-xs text-gray-400">
                  No fix available yet
                </div>
              )}
              {advisoryUrl && (
                <a
                  href={advisoryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/20 transition-colors"
                  onClick={e => e.stopPropagation()}
                >
                  View OSV Advisory ↗
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[40rem] overflow-auto bg-gray-950 rounded-xl space-y-8 p-1 relative">
      {GROUP_ORDER.map(({ type, label, icon }) => {
        const groupIssues = localIssues.filter(i => i.type === type);
        if (groupIssues.length === 0) return null;

        return (
          <div key={type} className="mb-8 last:mb-0">
            <h2 className="text-lg font-semibold text-gray-200 border-b border-gray-800 pb-2 mb-4 sticky top-0 bg-gray-950 z-10 flex items-center">
<<<<<<< HEAD
              {icon && <span className="mr-2">{icon}</span>}
              {label}{' '}
              <span className="text-gray-500 text-sm ml-2 font-normal">({groupIssues.length})</span>
=======
              {type === 'vulnerable_dependency' && <span className="mr-2">📦</span>}
              {type === 'hardcoded_secret' && <span className="mr-2">🔒</span>}
              {type === 'insecure_pattern' && <span className="mr-2">🛡️</span>}
              {label} <span className="text-gray-500 text-sm ml-2 font-normal">({groupIssues.length})</span>
>>>>>>> 864ff60768d4dc9244c3ac9267886cfcdaeea7eb
            </h2>
            <div className="grid gap-4">
              {groupIssues.map((issue, idx) => {
                // Vulnerable dependency — use specialised card
                if (type === 'vulnerable_dependency') {
                  return <VulnIssueCard key={issue.id || `vuln-${idx}`} issue={issue} idx={idx} />;
                }

                return (
                  <div
                    key={issue.id || `${type}-${idx}`}
                    onClick={() => handleIssueClick(issue)}
                    className="flex flex-col bg-gray-900/50 hover:bg-gray-800/80 border border-gray-800 hover:border-gray-700 rounded-lg p-5 cursor-pointer transition-all duration-200"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wider ${getBadgeStyles(issue.severity)}`}>
                        {issue.severity || 'UNKNOWN'}
                      </span>

                      {/* Mark as false positive — secrets */}
                      {type === 'hardcoded_secret' && (
                        <button
                          onClick={(e) => handleSuppress(e, issue)}
                          className="text-xs text-gray-400 hover:text-gray-200 underline transition-colors"
                        >
                          Mark as false positive
                        </button>
                      )}

                      {/* Disable this rule — insecure patterns */}
                      {type === 'insecure_pattern' && (
                        <button
                          onClick={(e) => handleDisableSastRule(e, issue)}
                          className="text-xs text-gray-400 hover:text-gray-200 underline transition-colors"
                        >
                          Disable this rule
                        </button>
                      )}
                    </div>

                    <p className="text-gray-300 text-sm mb-4 leading-relaxed whitespace-pre-wrap">
                      {issue.description || 'No description available.'}
                    </p>

                    <div className="mt-auto bg-gray-950/50 rounded-md p-3 border border-gray-800 break-words">
                      <span className="font-mono text-xs text-gray-400 leading-loose">
                        {issue.file_paths.join(' → ')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
