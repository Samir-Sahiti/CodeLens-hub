import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { AnswerBlock, SourceCard } from './SharedAnswerComponents';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXAMPLE_QUESTIONS = [
  'How does authentication work?',
  'Where is the database connection configured?',
  'What happens when a new user registers?',
  'Which files handle error logging?',
];

// ---------------------------------------------------------------------------
// HistoryItem
// ---------------------------------------------------------------------------

function HistoryItem({ query, onRerun }) {
  return (
    <button
      onClick={() => onRerun(query)}
      className="w-full text-left flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm text-gray-400 hover:bg-gray-800/60 hover:text-gray-200 transition-colors group"
    >
      <svg className="h-3.5 w-3.5 text-gray-600 group-hover:text-gray-400 shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span className="truncate">{query}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main SearchPanel
// ---------------------------------------------------------------------------

export default function SearchPanel({ repoId }) {
  const { session } = useAuth();

  const [inputValue, setInputValue]   = useState('');
  const [isStreaming, setIsStreaming]  = useState(false);
  const [answer, setAnswer]           = useState('');
  const [sources, setSources]         = useState([]);
  const [error, setError]             = useState(null);
  const [history, setHistory]         = useState([]);
  const [hasQueried, setHasQueried]   = useState(false);

  const inputRef  = useRef(null);
  const answerRef = useRef(null);
  const abortRef  = useRef(null);

  // Abort in-flight SSE stream on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  // Auto-scroll answer area as tokens arrive
  useEffect(() => {
    if (isStreaming && answerRef.current) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [answer, isStreaming]);

  const runQuery = useCallback(async (query) => {
    if (!query.trim() || isStreaming) return;

    // Abort any in-flight stream
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setInputValue(query);
    setIsStreaming(true);
    setAnswer('');
    setSources([]);
    setError(null);
    setHasQueried(true);

    // Deduplicate and prepend to history
    setHistory(prev => [query, ...prev.filter(q => q !== query)].slice(0, 10));

    try {
      const res = await fetch(apiUrl(`/api/search/${repoId}`), {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ query: query.trim() }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Server error ${res.status}`);
      }

      // Read the SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
  }, [repoId, session, isStreaming]);

  const handleSubmit = (e) => {
    e.preventDefault();
    runQuery(inputValue);
  };

  const handleExampleClick = (question) => {
    runQuery(question);
  };

  const handleHistoryRerun = (query) => {
    runQuery(query);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-[40rem] gap-6">

      {/* Left: history sidebar (hidden when no history) */}
      {history.length > 0 && (
        <aside className="w-60 shrink-0 rounded-xl border border-gray-800 bg-gray-900/50 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Recent queries</p>
          </div>
          <div className="flex-1 overflow-y-auto py-2">
            {history.map((q, i) => (
              <HistoryItem key={i} query={q} onRerun={handleHistoryRerun} />
            ))}
          </div>
        </aside>
      )}

      {/* Right: main search area */}
      <div className="flex flex-1 flex-col gap-4 min-w-0">

        {/* Search bar */}
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="How does authentication work?"
            disabled={isStreaming}
            className="flex-1 rounded-xl border border-gray-700 bg-gray-900 px-5 py-3 text-sm text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors disabled:opacity-60"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={() => { abortRef.current?.abort(); setIsStreaming(false); }}
              className="rounded-xl bg-gray-700 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-600 transition-colors shadow-sm"
            >
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              Ask
            </button>
          )}
        </form>

        {/* Content area */}
        <div ref={answerRef} className="flex-1 overflow-y-auto rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-6">

          {/* Pre-query empty state */}
          {!hasQueried && !isStreaming && (
            <div className="flex flex-col items-center justify-center h-full gap-6 py-4">
              <div className="text-center">
                <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 mb-4 mx-auto">
                  <svg className="h-6 w-6 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-gray-200 mb-1">Ask anything about your codebase</h3>
                <p className="text-sm text-gray-500 max-w-sm">
                  Natural language search powered by AI. Try one of these example questions to get started.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleExampleClick(q)}
                    className="text-left rounded-xl border border-gray-700 bg-gray-800/50 px-4 py-3 text-sm text-gray-300 hover:border-indigo-500/50 hover:bg-indigo-500/5 hover:text-indigo-300 transition-all group"
                  >
                    <span className="text-gray-600 group-hover:text-indigo-500 mr-1.5 text-xs">"</span>
                    {q}
                    <span className="text-gray-600 group-hover:text-indigo-500 text-xs">"</span>
                  </button>
                ))}
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

          {/* Streaming skeleton */}
          {isStreaming && !answer && (
            <div className="space-y-3 animate-pulse">
              <div className="h-3 bg-gray-800 rounded w-3/4" />
              <div className="h-3 bg-gray-800 rounded w-full" />
              <div className="h-3 bg-gray-800 rounded w-5/6" />
              <div className="h-3 bg-gray-800 rounded w-2/3" />
            </div>
          )}

          {/* Answer — now uses shared AnswerBlock */}
          {(answer || isStreaming) && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-500/15 border border-indigo-500/25">
                  <svg className="h-3.5 w-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                </div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Answer</p>
              </div>
              <AnswerBlock text={answer} isStreaming={isStreaming} />
            </div>
          )}

          {/* Sources — now uses shared SourceCard */}
          {sources.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 border border-gray-700">
                  <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                </div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                  Sources <span className="text-gray-700 font-normal normal-case tracking-normal">({sources.length} file{sources.length !== 1 ? 's' : ''})</span>
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
    </div>
  );
}
