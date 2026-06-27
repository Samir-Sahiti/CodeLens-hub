/**
 * AgentPanel — AI Repo Agent chat surface (US-070 + US-071).
 *
 * Replaces the old SearchPanel. Drives the tool-use loop via SSE against
 * POST /api/repos/:repoId/agent/chat, renders streaming text + inline
 * ToolCallCards, and shows a left-rail conversation history.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { useToast } from './Toast';
import { AnswerBlock } from './SharedAnswerComponents';
import {
  Sparkles, Send, StopCircle, Plus, ChevronDown, ChevronRight,
  Loader2, Check, AlertTriangle, Trash2, Pencil, Terminal, Clock, RefreshCw,
} from './ui/Icons';

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function formatTokens(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 100000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

/** Verb mapping for ToolCallCard headers. Static once compiled. */
const TOOL_VERBS = {
  get_graph_overview: () => 'the dependency graph',
  list_issues: ({ type, file, severity, sort_by }) => {
    const suffix = sort_by ? ` sorted by ${sort_by}` : '';
    if (file) return `issues in \`${file}\`${suffix}`;
    if (type) return `${type} issues${suffix}`;
    if (severity) return `${severity}-severity issues${suffix}`;
    return `all issues${suffix}`;
  },
  get_file_metrics: ({ path }) => `metrics for \`${path}\``,
  get_blast_radius: ({ path }) => `blast radius of \`${path}\``,
  get_dependents: ({ path }) => `files importing \`${path}\``,
  get_imports: ({ path }) => `imports of \`${path}\``,
  find_paths: ({ from_path, to_path }) => `paths \`${from_path}\` → \`${to_path}\``,
  get_attack_paths: ({ source }) => (source ? `attack paths from \`${source}\`` : 'all attack paths'),
  search_code: ({ query }) => `code matching "${query}"`,
  read_file: ({ path }) => `\`${path}\``,
  get_vulns: ({ severity }) => (severity ? `${severity}-severity vulnerabilities` : 'vulnerable dependencies'),
  propose_fix: () => 'a refactor proposal',
};

const TOOL_VERB_PREFIX = {
  get_graph_overview: 'Inspecting',
  list_issues: 'Listing',
  get_file_metrics: 'Reading',
  get_blast_radius: 'Computing',
  get_dependents: 'Looking up',
  get_imports: 'Looking up',
  find_paths: 'Finding',
  get_attack_paths: 'Tracing',
  search_code: 'Searching',
  read_file: 'Reading',
  get_vulns: 'Listing',
  propose_fix: 'Drafting',
};

function toolHeader(name, input = {}) {
  const verb = TOOL_VERB_PREFIX[name] || 'Calling';
  const arg = TOOL_VERBS[name]?.(input) || name;
  return `${verb} ${arg}`;
}

// ──────────────────────────────────────────────────────────────────────────
// ToolCallCard — collapsible inline tool execution
// ──────────────────────────────────────────────────────────────────────────

function ToolCallCard({ call, onOpenProposal }) {
  const [expanded, setExpanded] = useState(false);
  const status = call.status; // 'pending' | 'ok' | 'error'

  const StatusIcon = status === 'pending'
    ? <Loader2 className="h-3.5 w-3.5 text-indigo-400 animate-spin shrink-0" />
    : status === 'error'
      ? <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
      : <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;

  // propose_fix gets a special preview card when complete + successful.
  const isProposeFix = call.tool_name === 'propose_fix' && status === 'ok' && call.output?.proposal_id;

  return (
    <div className="my-2 rounded-lg border border-gray-800 bg-gray-900/50 text-xs">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/40 transition-colors"
      >
        <Terminal className="h-3.5 w-3.5 text-gray-500 shrink-0" />
        {StatusIcon}
        <span className="flex-1 truncate text-gray-300">{toolHeader(call.tool_name, call.input)}</span>
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-gray-600" />
          : <ChevronRight className="h-3.5 w-3.5 text-gray-600" />}
      </button>

      {isProposeFix && (
        <div className="border-t border-gray-800 px-3 py-2.5 bg-indigo-500/5">
          <div className="flex items-start gap-2">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-200">{call.output.summary || 'Proposal ready'}</p>
              <p className="mt-0.5 text-gray-500">
                {call.output.change_count} file change{call.output.change_count === 1 ? '' : 's'} ·
                {' '}{call.output.risk_count} risk{call.output.risk_count === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenProposal?.(call.output)}
              className="rounded-md border border-indigo-500/50 bg-indigo-500/10 px-2 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-500/20 transition-colors"
            >
              View in Issues
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t border-gray-800 px-3 py-2 space-y-2">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Input</p>
            <pre className="overflow-x-auto rounded bg-gray-950/60 p-2 text-[11px] text-gray-400">{JSON.stringify(call.input || {}, null, 2)}</pre>
          </div>
          {status !== 'pending' && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">Output</p>
              <pre className="overflow-x-auto rounded bg-gray-950/60 p-2 text-[11px] text-gray-400 max-h-64">{JSON.stringify(call.output ?? null, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// MessageList — renders the running conversation
// ──────────────────────────────────────────────────────────────────────────

function MessageList({ messages, onOpenProposal, isStreaming }) {
  return (
    <div className="space-y-5">
      {messages.map((m, idx) => {
        if (m.role === 'user') {
          return (
            <div key={m.id || idx} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-indigo-500/15 border border-indigo-500/20 px-4 py-2.5 text-sm text-gray-100 whitespace-pre-wrap">
                {m.text}
              </div>
            </div>
          );
        }
        if (m.role === 'assistant') {
          const isLast = idx === messages.length - 1;
          return (
            <div key={m.id || idx} className="space-y-1">
              {(m.text || isStreaming) && <AnswerBlock text={m.text || ''} isStreaming={isStreaming && isLast} />}
              {(m.toolCalls || []).map((tc) => (
                <ToolCallCard key={tc.tool_use_id} call={tc} onOpenProposal={onOpenProposal} />
              ))}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Composer — text input + send/cancel
// ──────────────────────────────────────────────────────────────────────────

function Composer({ value, onChange, onSend, onCancel, disabled, isStreaming }) {
  const taRef = useRef(null);
  // Autosize the textarea up to a cap.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) onSend();
    }
  };

  return (
    <div className="border-t border-gray-800 bg-gray-950/80 p-3">
      <div className="flex items-end gap-2 rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2 focus-within:border-indigo-500/60 transition-colors">
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about this repo…"
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-sm text-gray-100 placeholder-gray-600 focus:outline-none disabled:opacity-50"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={onCancel}
            title="Cancel"
            className="rounded-lg p-1.5 text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            <StopCircle className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || !value.trim()}
            title="Send (Enter)"
            className="rounded-lg p-1.5 text-indigo-300 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-30 transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="mt-1.5 px-1 text-[10px] text-gray-600">Enter to send · Shift+Enter for newline</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ConversationRail — left history list
// ──────────────────────────────────────────────────────────────────────────

function ConversationRail({ items, activeId, onSelect, onNew, onRename, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(null);

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditValue(item.title || '');
  };

  const commitEdit = async (item) => {
    const title = editValue.trim() || 'Untitled';
    setEditingId(null);
    if (title !== item.title) await onRename(item.id, title);
  };

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-gray-800 bg-gray-950/40">
      <div className="flex items-center justify-between px-3 py-3 border-b border-gray-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Conversations</h2>
        <button
          type="button"
          onClick={onNew}
          title="New conversation"
          className="rounded-md p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {items.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-gray-600">No conversations yet — ask the agent anything.</p>
        )}
        {items.map((item) => {
          const isActive = item.id === activeId;
          const isEditing = editingId === item.id;
          return (
            <div
              key={item.id}
              className={`group rounded-md ${isActive ? 'bg-indigo-500/10 border border-indigo-500/30' : 'hover:bg-gray-800/40 border border-transparent'}`}
            >
              <div className="flex items-start gap-1.5 px-2 py-2">
                <button
                  type="button"
                  onClick={() => !isEditing && onSelect(item.id)}
                  className="flex-1 min-w-0 text-left"
                  disabled={isEditing}
                >
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(item);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="w-full bg-transparent text-sm text-gray-100 outline-none border-b border-indigo-500/50"
                    />
                  ) : (
                    <>
                      <p className={`truncate text-sm ${isActive ? 'text-indigo-100' : 'text-gray-300'}`}>
                        {item.title || 'Untitled conversation'}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
                        <Clock className="h-2.5 w-2.5" />
                        <span>{formatRelativeTime(item.updated_at)}</span>
                        {item.total_tokens > 0 && (
                          <span className="rounded-full bg-gray-800 px-1.5 py-px text-[9px] tabular-nums text-gray-400">
                            {formatTokens(item.total_tokens)} tok
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </button>
                {!isEditing && (
                  <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      title="Rename"
                      className="rounded p-1 text-gray-500 hover:bg-gray-700/50 hover:text-gray-200"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(item.id)}
                      title="Delete"
                      className="rounded p-1 text-gray-500 hover:bg-red-500/15 hover:text-red-300"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              {confirmingDelete === item.id && (
                <div className="px-2 pb-2 text-[11px] text-gray-400 space-y-1">
                  <p>Delete this conversation?</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { onDelete(item.id); setConfirmingDelete(null); }}
                      className="rounded bg-red-500/20 px-2 py-0.5 text-red-200 hover:bg-red-500/30"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(null)}
                      className="rounded bg-gray-800 px-2 py-0.5 text-gray-300 hover:bg-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// EmptyState — shown when no messages yet
// ──────────────────────────────────────────────────────────────────────────

function EmptyState({ suggestions, onSuggestionClick }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-500/15 mb-4">
        <Sparkles className="h-7 w-7 text-indigo-300" />
      </div>
      <h2 className="text-xl font-semibold text-gray-100">Ask the repo agent</h2>
      <p className="mt-1.5 text-sm text-gray-500 text-center max-w-md">
        Grounded in your dependency graph, issue findings, and indexed code. Watch it call tools as it works.
      </p>
      <div className="mt-7 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
        {suggestions.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onSuggestionClick(s)}
            className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 text-left text-sm text-gray-300 hover:border-indigo-500/40 hover:bg-indigo-500/5 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Main AgentPanel
// ──────────────────────────────────────────────────────────────────────────

export default function AgentPanel({ repoId, onOpenFile, onSwitchTab }) {
  const { session } = useAuth();
  const toast = useToast();

  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [messages, setMessages] = useState([]); // unified turn objects, see below
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [budgetStopped, setBudgetStopped] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  const abortRef = useRef(null);
  const messageListRef = useRef(null);

  // ── Auto-scroll to the bottom of the message list when content grows ─────
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  // ── Cleanup any in-flight SSE on unmount ─────────────────────────────────
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // ── Load conversation list + suggestions on mount / repo change ──────────
  const fetchConversations = useCallback(async () => {
    if (!session?.access_token || !repoId) return;
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/agent/conversations`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.items || []);
    } catch {
      // ignore
    }
  }, [repoId, session?.access_token]);

  const fetchSuggestions = useCallback(async () => {
    if (!session?.access_token || !repoId) return;
    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/agent/suggestions`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setSuggestions(data.suggestions || []);
    } catch {
      // ignore
    }
  }, [repoId, session?.access_token]);

  useEffect(() => {
    fetchConversations();
    fetchSuggestions();
  }, [fetchConversations, fetchSuggestions]);

  // ── Rehydrate a saved conversation into the UI's message shape ───────────
  const loadConversation = useCallback(async (convId) => {
    if (!session?.access_token || convId === activeConvId) return;
    // Abort any in-flight stream and clear the previous conversation's messages
    // up front so its content doesn't linger (or get appended to) while the
    // selected conversation loads.
    abortRef.current?.abort();
    setActiveConvId(convId);
    setBudgetStopped(false);
    setMessages([]);
    try {
      const res = await fetch(apiUrl(`/api/agent/conversations/${convId}`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        toast.error('Could not load conversation');
        return;
      }
      const data = await res.json();
      setMessages(rowsToTurns(data.messages || []));
    } catch (err) {
      toast.error(err.message);
    }
  }, [activeConvId, session?.access_token, toast]);

  // ── New conversation (frontend-only until first send) ────────────────────
  const handleNewConversation = useCallback(() => {
    abortRef.current?.abort();
    setActiveConvId(null);
    setMessages([]);
    setBudgetStopped(false);
    setInput('');
  }, []);

  // ── Send a message ───────────────────────────────────────────────────────
  const handleSend = useCallback(async (overrideText) => {
    const text = (overrideText ?? input).trim();
    if (!text || !session?.access_token || isStreaming) return;

    setInput('');
    setBudgetStopped(false);

    // Optimistic: append user message + open an empty assistant turn.
    const userMsg = { role: 'user', text, id: `u-${Date.now()}` };
    const assistantMsg = { role: 'assistant', text: '', toolCalls: [], id: `a-${Date.now()}` };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(apiUrl(`/api/repos/${repoId}/agent/chat`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ conversation_id: activeConvId, message: text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const j = await res.json(); detail = j.error || detail; } catch {}
        throw new Error(detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }
          handleEvent(event);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast.error(err.message || 'Agent request failed');
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      fetchConversations();
    }
  }, [activeConvId, fetchConversations, input, isStreaming, repoId, session?.access_token, toast]);

  // ── Cancel in-flight stream ──────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Switch to the Issues tab so the user can open the persisted proposal.
  // The existing IssuesPanel renders a "PR opened" / "Open proposal" button
  // on each card based on a proposals/summary fetch — that's where the user
  // continues from. We don't deep-link to a specific proposal because
  // IssuesPanel doesn't expose an open-by-id API today.
  const handleOpenProposal = useCallback(() => {
    onSwitchTab?.('issues');
  }, [onSwitchTab]);

  // ── SSE event dispatcher ─────────────────────────────────────────────────
  const handleEvent = useCallback((event) => {
    switch (event.type) {
      case 'conversation_created':
        setActiveConvId(event.conversation_id);
        break;
      case 'text_delta':
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          // If the current assistant bubble already has any completed tool
          // call, this text_delta belongs to the NEXT iteration — start a
          // fresh bubble so iterations are visually separated.
          const hasCompletedTool = last?.role === 'assistant' &&
            (last.toolCalls || []).some((tc) => tc.status === 'ok' || tc.status === 'error');
          if (hasCompletedTool) {
            next.push({
              role: 'assistant',
              text: event.delta || '',
              toolCalls: [],
              id: `a-${Date.now()}-${Math.random()}`,
            });
            return next;
          }
          if (last?.role === 'assistant') {
            next[next.length - 1] = { ...last, text: (last.text || '') + (event.delta || '') };
          }
          return next;
        });
        break;
      case 'tool_use':
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant') {
            next[next.length - 1] = {
              ...last,
              toolCalls: [...(last.toolCalls || []), {
                tool_use_id: event.tool_use_id,
                tool_name: event.tool_name,
                input: event.input,
                status: 'pending',
              }],
            };
          }
          return next;
        });
        break;
      case 'tool_result':
        // Update the matching pending tool call wherever it lives. We scan
        // bubbles from last-to-first because multiple tool_uses in one
        // iteration emit their results in the SAME bubble — no new bubble.
        setMessages((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i -= 1) {
            const m = next[i];
            if (m.role !== 'assistant') continue;
            const idx = (m.toolCalls || []).findIndex((tc) => tc.tool_use_id === event.tool_use_id);
            if (idx >= 0) {
              const updated = m.toolCalls.slice();
              updated[idx] = { ...updated[idx], status: event.is_error ? 'error' : 'ok', output: event.output };
              next[i] = { ...m, toolCalls: updated };
              break;
            }
          }
          return next;
        });
        break;
      case 'budget_stopped':
        setBudgetStopped(true);
        break;
      case 'finish':
        // No-op — the streaming flag is cleared in the finally block.
        break;
      case 'error':
        toast.error(event.message || 'Agent error');
        break;
      default:
        break;
    }
  }, [toast]);

  // ── Conversation rail handlers ───────────────────────────────────────────
  const handleRename = useCallback(async (id, title) => {
    if (!session?.access_token) return;
    try {
      await fetch(apiUrl(`/api/agent/conversations/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ title }),
      });
      fetchConversations();
    } catch (err) {
      toast.error(err.message);
    }
  }, [fetchConversations, session?.access_token, toast]);

  const handleDelete = useCallback(async (id) => {
    if (!session?.access_token) return;
    try {
      await fetch(apiUrl(`/api/agent/conversations/${id}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (activeConvId === id) handleNewConversation();
      fetchConversations();
    } catch (err) {
      toast.error(err.message);
    }
  }, [activeConvId, fetchConversations, handleNewConversation, session?.access_token, toast]);

  const hasMessages = useMemo(() => messages.length > 0, [messages]);

  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-gray-800 bg-gray-900/30">
      <ConversationRail
        items={conversations}
        activeId={activeConvId}
        onSelect={loadConversation}
        onNew={handleNewConversation}
        onRename={handleRename}
        onDelete={handleDelete}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {budgetStopped && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            Conversation token cap reached. Start a new conversation to continue.
            <button
              type="button"
              onClick={handleNewConversation}
              className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-amber-100 hover:bg-amber-500/20"
            >
              <RefreshCw className="h-3 w-3" /> New
            </button>
          </div>
        )}

        <div ref={messageListRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {hasMessages
            ? <MessageList messages={messages} onOpenProposal={handleOpenProposal} isStreaming={isStreaming} />
            : <EmptyState suggestions={suggestions} onSuggestionClick={(s) => handleSend(s)} />
          }
        </div>

        <Composer
          value={input}
          onChange={setInput}
          onSend={() => handleSend()}
          onCancel={handleCancel}
          disabled={isStreaming || !session?.access_token}
          isStreaming={isStreaming}
        />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Rehydration helper
// ──────────────────────────────────────────────────────────────────────────

/**
 * Convert persisted agent_messages rows to the UI's turn model:
 *   { role: 'user', text }
 *   { role: 'assistant', text, toolCalls: [{tool_use_id, tool_name, input, status, output}] }
 *
 * Multiple persisted rows belong to one logical assistant turn:
 *   - role='assistant' (text) and role='tool_use' rows that follow it.
 * Tool results are folded into their matching toolCall entry rather than
 * shown as separate messages.
 */
function rowsToTurns(rows) {
  const turns = [];
  let currentAssistant = null;
  const flushAssistant = () => { if (currentAssistant) { turns.push(currentAssistant); currentAssistant = null; } };
  const ensureAssistant = () => {
    if (!currentAssistant) currentAssistant = { role: 'assistant', text: '', toolCalls: [] };
    return currentAssistant;
  };

  for (const row of rows) {
    const c = row.content_json || {};
    if (row.role === 'user') {
      flushAssistant();
      turns.push({ role: 'user', text: c.text || '', id: row.id });
    } else if (row.role === 'assistant') {
      const a = ensureAssistant();
      if (c.text) a.text = (a.text || '') + c.text;
      a.id = a.id || row.id;
    } else if (row.role === 'tool_use') {
      const a = ensureAssistant();
      a.toolCalls.push({
        tool_use_id: c.tool_use_id,
        tool_name: c.tool_name,
        input: c.input || {},
        status: 'pending',
      });
    } else if (row.role === 'tool_result') {
      // Find the matching tool_use across all turns (latest assistant).
      const target = currentAssistant || [...turns].reverse().find((t) => t.role === 'assistant');
      const tc = target?.toolCalls?.find((x) => x.tool_use_id === c.tool_use_id);
      if (tc) {
        tc.status = c.is_error ? 'error' : 'ok';
        tc.output = c.output;
      }
    }
  }
  flushAssistant();
  return turns;
}
