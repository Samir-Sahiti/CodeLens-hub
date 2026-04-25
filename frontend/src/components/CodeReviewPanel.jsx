/**
 * CodeReviewPanel.jsx — US-026 AI Code Review Panel
 *
 * Mirrors SearchPanel.jsx for SSE streaming, but with a code-review-specific UI.
 * Props: repoId (same as SearchPanel)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { AnswerBlock, SourceCard } from './SharedAnswerComponents';
import { Badge, Button, EmptyState } from './ui/Primitives';
import { AlertTriangle, Code2, FileCode, Sparkles, StopCircle } from './ui/Icons';

// ---------------------------------------------------------------------------
// Main CodeReviewPanel
// ---------------------------------------------------------------------------

const PRESETS = [
  { id: 'security',     label: 'Security',     hint: 'Focus on injection vulnerabilities, XSS, CSRF, secrets exposure, authentication flaws, and dangerous API usage.' },
  { id: 'performance',  label: 'Performance',  hint: 'Focus on algorithmic complexity, unnecessary re-renders, memory leaks, N+1 queries, and inefficient operations.' },
  { id: 'bugs',         label: 'Bug Hunt',     hint: 'Focus on off-by-one errors, null dereferences, unhandled edge cases, race conditions, and error-handling gaps.' },
  { id: 'architecture', label: 'Architecture', hint: 'Focus on separation of concerns, coupling, abstraction leaks, SOLID principles, and long-term maintainability.' },
];

export default function CodeReviewPanel({ repoId }) {
  const { session } = useAuth();

  // State — same pattern as SearchPanel
  const [snippet,            setSnippet]            = useState('');
  const [contextDescription, setContextDescription] = useState('');
  const [activePreset,       setActivePreset]       = useState(null);
  const [isStreaming,        setIsStreaming]         = useState(false);
  const [answer,             setAnswer]             = useState('');
  const [sources,            setSources]            = useState([]);
  const [error,              setError]              = useState(null);
  const [hasSubmitted,       setHasSubmitted]       = useState(false);

  const answerRef = useRef(null);
  const abortRef  = useRef(null);

  // Abort in-flight SSE stream on unmount — same as SearchPanel
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // Auto-scroll answer area as tokens arrive — same as SearchPanel
  useEffect(() => {
    if (isStreaming && answerRef.current) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [answer, isStreaming]);

  // ---------------------------------------------------------------------------
  // Core SSE streaming — same fetch + reader + decoder loop as SearchPanel
  // pointing to /api/review/:repoId with { snippet, context, mode }
  // ---------------------------------------------------------------------------

  const runReview = useCallback(async (mode) => {
    if (!snippet.trim() || isStreaming) return;

    // Abort any in-flight stream
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    setAnswer('');
    setSources([]);
    setError(null);
    setHasSubmitted(true);

    try {
      const res = await fetch(apiUrl(`/api/review/${repoId}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          snippet:  snippet.trim(),
          context:  [
            activePreset ? PRESETS.find(p => p.id === activePreset)?.hint : '',
            contextDescription.trim(),
          ].filter(Boolean).join('\n\n') || undefined,
          mode,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Server error ${res.status}`);
      }

      // Read the SSE stream — exact same loop as SearchPanel.runQuery
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'sources') {
              setSources(event.sources || []);
            } else if (event.type === 'chunk') {
              setAnswer(prev => prev + event.text);
            } else if (event.type === 'done') {
              setIsStreaming(false);
            } else if (event.type === 'error') {
              setError(event.message);
              setIsStreaming(false);
            }
          } catch {
            // Malformed event — skip
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsStreaming(false);
    }
  }, [repoId, session, isStreaming, snippet, contextDescription]);

  // Derived: line count for badge
  const lineCount      = snippet ? snippet.split('\n').length : 0;
  const lineLimit      = 200;
  const isOverLimit    = lineCount > lineLimit;
  const canSubmit      = snippet.trim().length > 0 && !isStreaming && !isOverLimit;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-auto min-h-[30rem] flex-col gap-4 xl:h-[calc(100vh-12rem)]">

      {/* Input area */}
      <div className="shrink-0 rounded-xl border border-surface-800 bg-surface-900/70 p-3 shadow-panel">

        {/* Snippet textarea with line count badge */}
        <div className="relative">
          <textarea
            value={snippet}
            onChange={e => setSnippet(e.target.value)}
            placeholder="Paste your code here (up to 200 lines)..."
            disabled={isStreaming}
            rows={8}
            className="max-h-[32vh] min-h-[10rem] w-full resize-y rounded-lg border border-surface-700 bg-surface-950 px-4 py-3 font-mono text-sm leading-6 text-white outline-none transition-colors placeholder:text-gray-600 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-60"
          />
          {/* Line count badge */}
          <div className={`absolute bottom-3 right-3 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            isOverLimit
              ? 'bg-red-500/20 text-red-400 ring-1 ring-inset ring-red-500/30'
              : 'bg-gray-800 text-gray-400'
          }`}>
            {lineCount} / {lineLimit} lines
          </div>
        </div>

        {/* Over-limit warning */}
        {isOverLimit && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-red-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Snippet exceeds 200 lines. Please trim it before submitting.
          </p>
        )}

        {/* Review focus presets */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-xs uppercase tracking-[0.16em] text-gray-500">Focus</span>
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={isStreaming}
              onClick={() => setActivePreset(p => p === preset.id ? null : preset.id)}
              title={preset.hint}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                activePreset === preset.id
                  ? 'border-primary-500/50 bg-primary-500/15 text-primary-200'
                  : 'border-surface-700 text-gray-400 hover:border-surface-500 hover:text-gray-200'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Context field */}
        <input
          type="text"
          value={contextDescription}
          onChange={e => setContextDescription(e.target.value)}
          placeholder="What is this code supposed to do? (optional)"
          disabled={isStreaming}
          className="mt-3 w-full rounded-lg border border-surface-700 bg-surface-950 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-60"
        />

        {/* Action buttons row */}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          {isStreaming ? (
            <Button
              type="button"
              onClick={() => { abortRef.current?.abort(); setIsStreaming(false); }}
              variant="secondary"
              className="w-full sm:w-auto"
            >
              <StopCircle className="h-4 w-4" />
              Cancel
            </Button>
          ) : (
            <>
              {/* Review Code — primary */}
              <Button
                onClick={() => runReview('review')}
                disabled={!canSubmit}
                className="w-full sm:w-auto"
              >
                <Sparkles className="h-4 w-4" />
                Review Code
              </Button>

              {/* Clean up this code — secondary/outlined */}
              <Button
                onClick={() => runReview('cleanup')}
                disabled={!canSubmit}
                variant="secondary"
                className="w-full sm:w-auto"
              >
                <Code2 className="h-4 w-4" />
                Clean up this code
              </Button>
            </>
          )}
          <Badge className="sm:ml-auto">{lineCount} / {lineLimit} lines</Badge>
        </div>
      </div>

      {/* Response area — scrollable div identical to SearchPanel */}
      <div
        ref={answerRef}
        className="min-h-[18rem] flex-1 space-y-6 overflow-y-auto rounded-xl border border-surface-800 bg-surface-900/50 p-4 sm:p-5"
      >
        {/* Pre-submit empty state */}
        {!hasSubmitted && !isStreaming && (
          <EmptyState
            icon={FileCode}
            title="AI Code Review"
            description="Paste a focused snippet, choose a review mode, and CodeLens will compare it against nearby codebase patterns."
            className="min-h-[15rem] border-0 bg-transparent"
          />
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-800 bg-red-900/30 p-4 text-sm text-red-200">
            <p className="font-medium mb-1">Something went wrong</p>
            <p className="text-red-300/80">{error}</p>
          </div>
        )}

        {/* Streaming skeleton — same as SearchPanel */}
        {isStreaming && !answer && (
          <div className="space-y-3 animate-pulse">
            <div className="h-3 bg-gray-800 rounded w-3/4" />
            <div className="h-3 bg-gray-800 rounded w-full" />
            <div className="h-3 bg-gray-800 rounded w-5/6" />
            <div className="h-3 bg-gray-800 rounded w-2/3" />
          </div>
        )}

        {/* Answer — reuses AnswerBlock from SharedAnswerComponents */}
        {(answer || isStreaming) && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-500/15 border border-indigo-500/25">
                <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Review</p>
            </div>
            <AnswerBlock text={answer} isStreaming={isStreaming} />
          </div>
        )}

        {/* Sources — reuses SourceCard from SharedAnswerComponents */}
        {sources.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 border border-gray-700">
                <Code2 className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                Similar codebase files <span className="text-gray-700 font-normal normal-case tracking-normal">({sources.length})</span>
              </p>
            </div>
            <div className="space-y-3">
              {sources.map((source, i) => (
                <SourceCard key={`${source.file_path}-${source.start_line}`} source={source} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
