/**
 * CodeReviewPanel.jsx — US-026 AI Code Review Panel
 *
 * Mirrors SearchPanel.jsx for SSE streaming, but with a code-review-specific UI.
 * Props: repoId (same as SearchPanel)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { AnswerBlock, SourceCard } from './SharedAnswerComponents';

// ---------------------------------------------------------------------------
// Main CodeReviewPanel
// ---------------------------------------------------------------------------

export default function CodeReviewPanel({ repoId }) {
  const { session } = useAuth();

  // State — same pattern as SearchPanel
  const [snippet,            setSnippet]            = useState('');
  const [contextDescription, setContextDescription] = useState('');
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
      const res = await fetch(`/api/review/${repoId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          snippet:  snippet.trim(),
          context:  contextDescription.trim() || undefined,
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
    <div className="flex h-[40rem] flex-col gap-4">

      {/* Input area */}
      <div className="flex flex-col gap-3">

        {/* Snippet textarea with line count badge */}
        <div className="relative">
          <textarea
            value={snippet}
            onChange={e => setSnippet(e.target.value)}
            placeholder="Paste your code here (up to 200 lines)..."
            disabled={isStreaming}
            rows={10}
            className="w-full rounded-xl border border-gray-700 bg-gray-900 px-5 py-4 font-mono text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors disabled:opacity-60 resize-y"
            style={{ minHeight: '200px' }}
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
          <p className="text-xs text-red-400">
            Snippet exceeds 200 lines. Please trim it before submitting.
          </p>
        )}

        {/* Context field */}
        <input
          type="text"
          value={contextDescription}
          onChange={e => setContextDescription(e.target.value)}
          placeholder="What is this code supposed to do? (optional)"
          disabled={isStreaming}
          className="rounded-xl border border-gray-700 bg-gray-900 px-5 py-3 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors disabled:opacity-60"
        />

        {/* Action buttons row */}
        <div className="flex items-center gap-3">
          {/* Review Code — primary */}
          <button
            onClick={() => runReview('review')}
            disabled={!canSubmit}
            className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {isStreaming ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Reviewing…
              </span>
            ) : 'Review Code'}
          </button>

          {/* Clean up this code — secondary/outlined */}
          <button
            onClick={() => runReview('cleanup')}
            disabled={!canSubmit}
            className="rounded-xl border border-gray-700 bg-transparent px-5 py-3 text-sm font-semibold text-gray-200 hover:bg-gray-800 hover:border-gray-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isStreaming ? 'Working…' : 'Clean up this code'}
          </button>
        </div>
      </div>

      {/* Response area — scrollable div identical to SearchPanel */}
      <div
        ref={answerRef}
        className="flex-1 overflow-y-auto rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-6"
      >
        {/* Pre-submit empty state */}
        {!hasSubmitted && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
              <svg className="h-6 w-6 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-base font-semibold text-gray-200 mb-1">AI Code Review</h3>
              <p className="text-sm text-gray-500 max-w-sm">
                Paste a code snippet above and click <strong className="text-gray-300">Review Code</strong> to get quality feedback grounded in your codebase's patterns.
                Use <strong className="text-gray-300">Clean up this code</strong> to get a rewritten version that matches your repo's conventions.
              </p>
            </div>
          </div>
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
                <svg className="h-3.5 w-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
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
                <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                </svg>
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
