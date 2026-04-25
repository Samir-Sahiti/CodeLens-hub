import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { useToast } from './Toast';
import { AnswerBlock, SourceCard } from './SharedAnswerComponents';
import { X, Info, Sparkles } from './ui/Icons';
import Tooltip from './ui/Tooltip';

const SUGGESTIONS = [
  'Explain what this file does.',
  'Find potential bugs in this code.',
  'Summarize key functions/classes and responsibilities.',
  'List risky edge cases and suggested tests.',
];

function getBasename(filePath) {
  if (!filePath) return 'Unknown file';
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

export default function FileChatPanel({ repoId, filePath, open, onClose }) {
  const { session } = useAuth();
  const toast = useToast();

  const [inputValue,     setInputValue]     = useState('');
  const [includeImports, setIncludeImports] = useState(true);
  const [isStreaming,    setIsStreaming]     = useState(false);
  const [answer,         setAnswer]         = useState('');
  const [sources,        setSources]        = useState([]);
  const [hasAsked,       setHasAsked]       = useState(false);

  const inputRef  = useRef(null);
  const answerRef = useRef(null);
  const abortRef  = useRef(null);

  const title = useMemo(() => getBasename(filePath), [filePath]);

  useEffect(() => {
    if (!open) return;
    setInputValue(''); setAnswer(''); setSources([]); setHasAsked(false); setIsStreaming(false);
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, filePath]);

  useEffect(() => {
    if (isStreaming && answerRef.current) answerRef.current.scrollTop = answerRef.current.scrollHeight;
  }, [answer, isStreaming]);

  const runQuery = useCallback(async (query) => {
    if (!open || !repoId || !filePath || !query?.trim() || isStreaming) return;
    if (!session?.access_token) { toast.error('You are not authenticated.'); return; }

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true); setAnswer(''); setSources([]); setHasAsked(true);

    try {
      const res = await fetch(apiUrl(`/api/file-chat/${repoId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ filePath, query: query.trim(), includeImports }),
        signal: controller.signal,
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Server error ${res.status}`); }

      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if      (ev.type === 'sources') setSources(ev.sources || []);
            else if (ev.type === 'chunk')   setAnswer(p => p + ev.text);
            else if (ev.type === 'done')    setIsStreaming(false);
            else if (ev.type === 'error')   { toast.error(ev.message || 'File chat failed.'); setIsStreaming(false); }
          } catch {}
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      toast.error(err.message || 'An unexpected error occurred.');
    } finally { setIsStreaming(false); }
  }, [open, repoId, filePath, includeImports, isStreaming, session?.access_token, toast]);

  const handleSubmit = useCallback((e) => { e.preventDefault(); runQuery(inputValue); }, [inputValue, runQuery]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" style={{ animation: 'fadeIn 200ms ease forwards' }} onClick={() => !isStreaming && onClose?.()} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col border-l border-gray-800 bg-gray-950 shadow-2xl" style={{ animation: 'slideInFromRight 280ms cubic-bezier(0.34,1.56,0.64,1) forwards' }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-800 bg-gray-900/40 px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Chat With This File</p>
            <h2 className="mt-2 truncate font-mono text-sm text-gray-100">{title}</h2>
            <p className="mt-1 truncate text-xs text-gray-500">{filePath}</p>
          </div>
          <button onClick={() => !isStreaming && onClose?.()} disabled={isStreaming} aria-label="Close" className="shrink-0 flex items-center justify-center h-8 w-8 rounded-lg border border-gray-700 bg-gray-900/70 text-gray-400 hover:bg-gray-800 hover:text-white transition disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Input */}
        <div className="border-b border-gray-800 px-4 py-4 sm:px-6">
          <form onSubmit={handleSubmit}>
            <div className="flex flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-900/50 transition-all focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500/30 sm:flex-row">
              <input ref={inputRef} value={inputValue} onChange={e => setInputValue(e.target.value)} placeholder="Ask a question about this file…" disabled={isStreaming} className="min-w-0 flex-1 bg-transparent px-4 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none disabled:opacity-60" />
              <button type="submit" disabled={isStreaming || !inputValue.trim()} className="border-t border-indigo-700 bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 sm:border-l sm:border-t-0">
                {isStreaming ? 'Thinking…' : 'Ask'}
              </button>
            </div>
          </form>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
              <input type="checkbox" checked={includeImports} onChange={e => setIncludeImports(e.target.checked)} disabled={isStreaming} className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-indigo-500" />
              Include direct imports
            </label>
            <Tooltip content="RAG vector search is disabled. The AI uses the file content and direct imports as context." position="top" className="max-w-[260px] whitespace-normal text-center leading-relaxed">
              <div className="flex items-center gap-1.5 text-xs text-gray-600 cursor-default">
                <Info className="h-3.5 w-3.5" /> <span>RAG disabled</span>
              </div>
            </Tooltip>
          </div>
        </div>

        {/* Answers */}
        <div ref={answerRef} className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
          {!hasAsked && !isStreaming && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/30 p-5" style={{ animation: 'slideUp 250ms ease both' }}>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Suggestions</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SUGGESTIONS.map((s, i) => (
                  <button key={s} onClick={() => { setInputValue(s); runQuery(s); }} className="text-left rounded-xl border border-gray-700 bg-gray-950/40 px-4 py-3 text-sm text-gray-200 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition" style={{ animation: `slideUp 250ms ease ${i * 50}ms both` }}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {isStreaming && !answer && <div className="space-y-3 animate-pulse"><div className="h-3 bg-gray-800 rounded w-3/4"/><div className="h-3 bg-gray-800 rounded w-full"/><div className="h-3 bg-gray-800 rounded w-5/6"/></div>}
          {(answer || isStreaming) && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-500/15 border border-indigo-500/25">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Answer</p>
              </div>
              <AnswerBlock text={answer} isStreaming={isStreaming} />
            </div>
          )}
          {sources.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Context <span className="text-gray-700 font-normal normal-case tracking-normal">({sources.length} file{sources.length !== 1 ? 's' : ''})</span></p>
              <div className="space-y-3">{sources.map((s, i) => <SourceCard key={`${s.file_path}-${s.start_line || i}`} source={s} index={i} />)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
