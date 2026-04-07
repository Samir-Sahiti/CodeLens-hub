import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

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
// Small sub-components
// ---------------------------------------------------------------------------

function CopyIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
    </svg>
  );
}

function ChevronDownIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function ChevronUpIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
    </svg>
  );
}

// Detect language from file extension for syntax highlighting class
function getLanguageClass(filePath) {
  if (!filePath) return 'language-text';
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map = {
    js: 'language-javascript', jsx: 'language-javascript',
    ts: 'language-typescript', tsx: 'language-typescript',
    py: 'language-python',
    cs: 'language-csharp',
    json: 'language-json',
    md: 'language-markdown',
    css: 'language-css',
    html: 'language-html',
  };
  return map[ext] || 'language-text';
}

// ---------------------------------------------------------------------------
// AnswerBlock — renders markdown-ish answer with fenced code block support
// ---------------------------------------------------------------------------

function AnswerBlock({ text, isStreaming }) {
  // Simple renderer: split on ```...``` blocks, alternate prose / code
  const segments = [];
  const fenceRe = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
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
        // Prose: handle **bold**, `inline code`, and line breaks
        return (
          <div key={i} className="text-gray-300 leading-relaxed space-y-2">
            {seg.content.split('\n').map((line, j) => {
              if (!line.trim()) return <br key={j} />;
              // Bold: **text**
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

function SourceCard({ source, index }) {
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

  const inputRef       = useRef(null);
  const answerRef      = useRef(null);
  const abortRef       = useRef(null);

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
      const res = await fetch(`/api/search/${repoId}`, {
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
          <button
            type="submit"
            disabled={!inputValue.trim() || isStreaming}
            className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {isStreaming ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Thinking…
              </span>
            ) : 'Ask'}
          </button>
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

          {/* Answer */}
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

          {/* Sources */}
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