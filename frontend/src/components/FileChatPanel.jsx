import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { useToast } from './Toast';
import { AnswerBlock, SourceCard } from './SharedAnswerComponents';

const SUGGESTIONS = [
  'Explain what this file does.',
  'Find potential bugs in this code.',
  'Summarize key functions/classes and responsibilities.',
  'List risky edge cases and suggested tests.',
];

function getBasename(filePath) {
  if (!filePath) return 'Unknown file';
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

export default function FileChatPanel({ repoId, filePath, open, onClose }) {
  const { session } = useAuth();
  const toast = useToast();

  const [inputValue, setInputValue] = useState('');
  const [includeImports, setIncludeImports] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [answer, setAnswer] = useState('');
  const [sources, setSources] = useState([]);
  const [hasAsked, setHasAsked] = useState(false);

  const inputRef = useRef(null);
  const answerRef = useRef(null);
  const abortRef = useRef(null);

  const title = useMemo(() => getBasename(filePath), [filePath]);

  useEffect(() => {
    if (!open) return;
    setInputValue('');
    setAnswer('');
    setSources([]);
    setHasAsked(false);
    setIsStreaming(false);
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Focus the input shortly after mount.
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, filePath]);

  useEffect(() => {
    if (isStreaming && answerRef.current) {
      answerRef.current.scrollTop = answerRef.current.scrollHeight;
    }
  }, [answer, isStreaming]);

  const runQuery = useCallback(async (query) => {
    if (!open) return;
    if (!repoId || !filePath) return;
    if (!query?.trim() || isStreaming) return;

    if (!session?.access_token) {
      toast.error('You are not authenticated.');
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    setAnswer('');
    setSources([]);
    setHasAsked(true);

    try {
      const res = await fetch(apiUrl(`/api/file-chat/${repoId}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          filePath,
          query: query.trim(),
          includeImports,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Server error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'sources') {
              setSources(event.sources || []);
            } else if (event.type === 'chunk') {
              setAnswer((prev) => prev + event.text);
            } else if (event.type === 'done') {
              setIsStreaming(false);
            } else if (event.type === 'error') {
              toast.error(event.message || 'File chat failed.');
              setIsStreaming(false);
            }
          } catch {
            /* ignore malformed events */
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      toast.error(err.message || 'An unexpected error occurred.');
    } finally {
      setIsStreaming(false);
    }
  }, [open, repoId, filePath, includeImports, isStreaming, session?.access_token, toast]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    runQuery(inputValue);
  }, [inputValue, runQuery]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !isStreaming && onClose?.()} />

      <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-gray-950 border-l border-gray-800 shadow-2xl shadow-black/60 flex flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-gray-800 bg-gray-900/40 px-6 py-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Chat With This File</p>
            <h2 className="mt-2 truncate font-mono text-sm text-gray-100">{title}</h2>
            <p className="mt-1 truncate text-xs text-gray-500">{filePath}</p>
          </div>
          <button
            onClick={() => !isStreaming && onClose?.()}
            className="shrink-0 rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 transition disabled:opacity-50"
            disabled={isStreaming}
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <div className="px-6 py-4 border-b border-gray-800">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask a question about this file…"
              className="flex-1 rounded-xl border border-gray-700 bg-gray-900/50 px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              disabled={isStreaming}
            />
            <button
              type="submit"
              disabled={isStreaming || !inputValue.trim()}
              className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isStreaming ? 'Thinking…' : 'Ask'}
            </button>
          </form>

          <div className="mt-3 flex items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={includeImports}
                onChange={(e) => setIncludeImports(e.target.checked)}
                className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-indigo-500 focus:ring-indigo-500"
                disabled={isStreaming}
              />
              Include direct imports
            </label>

            <div className="flex items-center gap-2 text-xs text-gray-500">
              RAG search disabled for this session
            </div>
          </div>
        </div>

        <div ref={answerRef} className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {!hasAsked && !isStreaming && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Suggestions</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setInputValue(s);
                      runQuery(s);
                    }}
                    className="text-left rounded-xl border border-gray-700 bg-gray-950/40 px-4 py-3 text-sm text-gray-200 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isStreaming && !answer && (
            <div className="space-y-3 animate-pulse">
              <div className="h-3 bg-gray-800 rounded w-3/4" />
              <div className="h-3 bg-gray-800 rounded w-full" />
              <div className="h-3 bg-gray-800 rounded w-5/6" />
              <div className="h-3 bg-gray-800 rounded w-2/3" />
            </div>
          )}

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

          {sources.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 border border-gray-700">
                  <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                </div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                  Context <span className="text-gray-700 font-normal normal-case tracking-normal">({sources.length} file{sources.length !== 1 ? 's' : ''})</span>
                </p>
              </div>
              <div className="space-y-3">
                {sources.map((source, i) => (
                  <SourceCard key={`${source.file_path}-${source.start_line || i}`} source={source} index={i} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

