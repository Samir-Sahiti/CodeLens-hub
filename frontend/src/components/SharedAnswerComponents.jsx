/**
 * SharedAnswerComponents.jsx
 *
 * Shared UI components extracted from SearchPanel.jsx for reuse
 * in CodeReviewPanel.jsx and any future panels that render streamed
 * Claude responses and source references.
 *
 * Exports:
 *   - CopyIcon
 *   - ChevronDownIcon
 *   - ChevronUpIcon
 *   - getLanguageClass
 *   - AnswerBlock
 *   - SourceCard
 */

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Icon helpers
// ---------------------------------------------------------------------------

export function CopyIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
    </svg>
  );
}

export function ChevronDownIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

export function ChevronUpIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Language detection helper
// ---------------------------------------------------------------------------

export function getLanguageClass(filePath) {
  if (!filePath) return 'language-text';
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map = {
    js:   'language-javascript', jsx: 'language-javascript',
    ts:   'language-typescript', tsx: 'language-typescript',
    py:   'language-python',
    cs:   'language-csharp',
    json: 'language-json',
    md:   'language-markdown',
    css:  'language-css',
    html: 'language-html',
  };
  return map[ext] || 'language-text';
}

// ---------------------------------------------------------------------------
// AnswerBlock — renders markdown-ish answer with fenced code block support
// ---------------------------------------------------------------------------

export function AnswerBlock({ text, isStreaming }) {
  const segments = [];
  const fenceRe  = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex  = 0;
  let match;

  while ((match = fenceRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'prose', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'code', lang: match[1] || 'text', content: match[2] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'prose', content: text.slice(lastIndex) });
  }

  if (segments.length === 0) return null;

  return (
    <div className="prose prose-invert prose-sm max-w-none">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          return (
            <div key={i} className="relative my-4 rounded-lg overflow-hidden border border-gray-700">
              {seg.lang && (
                <div className="flex items-center justify-between bg-gray-800 px-4 py-1.5 text-xs font-medium text-gray-400 border-b border-gray-700">
                  <span>{seg.lang}</span>
                </div>
              )}
              <pre className="overflow-x-auto bg-gray-950 p-4 text-sm leading-relaxed">
                <code className={`${getLanguageClass('.' + seg.lang)} text-gray-200 font-mono`}>
                  {seg.content}
                </code>
              </pre>
            </div>
          );
        }
        return (
          <div key={i} className="text-gray-300 leading-relaxed space-y-2">
            {seg.content.split('\n').map((line, j) => {
              if (!line.trim()) return <br key={j} />;
              const parts = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/);
              return (
                <p key={j} className="m-0">
                  {parts.map((part, k) => {
                    if (part.startsWith('**') && part.endsWith('**')) {
                      return <strong key={k} className="font-semibold text-gray-100">{part.slice(2, -2)}</strong>;
                    }
                    if (part.startsWith('`') && part.endsWith('`')) {
                      return <code key={k} className="bg-gray-800 text-indigo-300 rounded px-1.5 py-0.5 font-mono text-xs">{part.slice(1, -1)}</code>;
                    }
                    return part;
                  })}
                </p>
              );
            })}
          </div>
        );
      })}
      {isStreaming && (
        <span className="inline-block h-4 w-0.5 bg-indigo-400 animate-pulse ml-0.5 align-middle" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceCard — one referenced chunk from the RAG retrieval
// ---------------------------------------------------------------------------

export function SourceCard({ source, index }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied]     = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(source.file_path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  const langClass = getLanguageClass(source.file_path);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 overflow-hidden text-sm">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 bg-gray-800/50 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-gray-500 shrink-0">#{index + 1}</span>
          <button
            onClick={handleCopy}
            title="Copy file path"
            className="flex items-center gap-1.5 min-w-0 group"
          >
            <span className="font-mono text-xs text-indigo-400 group-hover:text-indigo-300 truncate transition-colors">
              {source.file_path}
            </span>
            <CopyIcon className="h-3.5 w-3.5 text-gray-600 group-hover:text-indigo-400 shrink-0 transition-colors" />
          </button>
          {copied && (
            <span className="text-xs text-emerald-400 shrink-0">Copied!</span>
          )}
        </div>
        <span className="text-xs text-gray-600 shrink-0 whitespace-nowrap">
          L{source.start_line}–{source.end_line}
        </span>
      </div>

      {/* Excerpt (always visible — first 2 lines) */}
      <pre className="overflow-x-auto px-4 py-3 bg-gray-950/70 text-xs leading-relaxed">
        <code className={`${langClass} text-gray-400 font-mono`}>
          {source.excerpt}
        </code>
      </pre>

      {/* Expand toggle */}
      {source.full_content && source.full_content !== source.excerpt && (
        <>
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-gray-600 hover:text-gray-400 hover:bg-gray-800/40 transition-colors border-t border-gray-800"
          >
            {expanded ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
            {expanded ? 'Collapse' : 'Expand full chunk'}
          </button>
          {expanded && (
            <pre className="overflow-x-auto px-4 py-3 bg-gray-950 text-xs leading-relaxed border-t border-gray-800">
              <code className={`${langClass} text-gray-400 font-mono`}>
                {source.full_content}
              </code>
            </pre>
          )}
        </>
      )}
    </div>
  );
}
