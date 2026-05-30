import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { formatDate } from '../lib/constants';
import {
  Bell, CheckCheck, X, ShieldAlert, Package, CheckCircle2, XCircle, GitBranch, Star, Sparkles,
} from './ui/Icons';

export const TYPE_META = {
  new_critical_issue: { icon: ShieldAlert, label: 'New critical issue' },
  new_vulnerability:  { icon: Package,     label: 'New vulnerability' },
  index_ready:        { icon: CheckCircle2, label: 'Index ready' },
  index_failed:       { icon: XCircle,     label: 'Index failed' },
  pr_review_ready:    { icon: GitBranch,   label: 'PR review ready' },
  proposal_shared:    { icon: Sparkles,    label: 'Proposal shared' },
  tour_shared:        { icon: Star,        label: 'Tour forked' },
  webhook_paused:     { icon: XCircle,     label: 'Webhook paused' },
};

export const SEVERITY_DOT = {
  critical: 'bg-red-500',
  warning: 'bg-yellow-500',
  info: 'bg-sky-500',
};

export function notificationText(n) {
  const p = n.payload_json || {};
  switch (n.type) {
    case 'new_critical_issue': return p.message || `Critical issue in ${p.file_path || 'a file'}`;
    case 'new_vulnerability':  return p.message || `Vulnerable dependency detected`;
    case 'index_ready':        return `Indexing finished${p.file_count ? ` (${p.file_count} files)` : ''}`;
    case 'index_failed':       return p.message || 'Indexing failed';
    case 'pr_review_ready':    return `PR #${p.pr_number} review ready — ${p.total_findings || 0} findings`;
    case 'tour_shared':        return 'Someone forked your tour';
    default:                   return TYPE_META[n.type]?.label || 'Notification';
  }
}

function groupByDay(notifications) {
  const groups = new Map();
  for (const n of notifications) {
    const day = new Date(n.created_at).toDateString();
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(n);
  }
  return [...groups.entries()];
}

export default function NotificationBell({ collapsed }) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const token = session?.access_token;
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  const fetchUnread = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl('/api/notifications/unread-count'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setUnread(data.unread || 0);
    } catch { /* ignore */ }
  }, [token]);

  const fetchItems = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/notifications?limit=20'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications || []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [token]);

  // Badge poll: every 60s while the app is in the foreground.
  useEffect(() => {
    if (!token) return undefined;
    fetchUnread();
    const id = setInterval(() => { if (!document.hidden) fetchUnread(); }, 60_000);
    return () => clearInterval(id);
  }, [token, fetchUnread]);

  // Dropdown poll: every 30s while open.
  useEffect(() => {
    if (!open) return undefined;
    fetchItems();
    const id = setInterval(fetchItems, 30_000);
    return () => clearInterval(id);
  }, [open, fetchItems]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const markRead = useCallback(async (id) => {
    if (!token) return;
    try {
      await fetch(apiUrl(`/api/notifications/${id}/read`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* ignore */ }
  }, [token]);

  const handleRowClick = async (n) => {
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      await markRead(n.id);
    }
    setOpen(false);
    if (n.link_url) navigate(n.link_url);
  };

  const markAllRead = async () => {
    if (!token) return;
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    setUnread(0);
    try {
      await fetch(apiUrl('/api/notifications/mark-all-read'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* ignore */ }
  };

  const groups = useMemo(() => groupByDay(items), [items]);
  const badge = unread > 99 ? '99+' : String(unread);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className={`flex w-full items-center rounded-lg px-3 py-2 text-sm text-gray-400 transition-colors hover:bg-surface-800 hover:text-white ${collapsed ? 'justify-center' : 'gap-3'}`}
      >
        <span className="relative">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {badge}
            </span>
          )}
        </span>
        {!collapsed && <span className="hidden lg:inline">Notifications</span>}
      </button>

      {open && (
        <div
          className="fixed bottom-4 left-20 z-50 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl"
          style={{ animation: 'slideUp 150ms ease both' }}
        >
          <div className="flex items-center justify-between border-b border-surface-800 px-4 py-3">
            <span className="text-sm font-semibold text-white">Notifications</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={markAllRead} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white" title="Mark all as read">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all
              </button>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-500 hover:text-white" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">Loading...</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">No notifications yet.</p>
            ) : (
              groups.map(([day, dayItems]) => (
                <div key={day}>
                  <p className="sticky top-0 bg-surface-900/95 px-4 py-1.5 text-[11px] uppercase tracking-wider text-gray-500">{day}</p>
                  {dayItems.map((n) => {
                    const Icon = TYPE_META[n.type]?.icon || Bell;
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => handleRowClick(n)}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-800 ${n.read_at ? 'opacity-60' : ''}`}
                      >
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[n.severity] || 'bg-gray-500'}`} />
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-gray-200">{notificationText(n)}</span>
                          <span className="text-xs text-gray-500">{TYPE_META[n.type]?.label || n.type} · {formatDate(n.created_at)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="border-t border-surface-800 px-4 py-2.5 text-center text-xs text-indigo-300 hover:bg-surface-800 hover:text-indigo-200"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
