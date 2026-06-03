import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { formatDate } from '../lib/constants';
import { Button, EmptyState, Banner } from '../components/ui/Primitives';
import { Bell, CheckCheck } from '../components/ui/Icons';
import { TYPE_META, SEVERITY_DOT, notificationLink, notificationText } from '../components/NotificationBell';

const PAGE_SIZE = 50;

export default function NotificationsPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const token = session?.access_token;
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadPage = useCallback(async (before) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (before) qs.set('before', before);
      const res = await fetch(apiUrl(`/api/notifications?${qs.toString()}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load notifications');
      setItems((prev) => (before ? [...prev, ...(data.notifications || [])] : data.notifications || []));
      setCursor(data.next_cursor || null);
      setHasMore(Boolean(data.has_more));
    } catch (err) {
      setError(err.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadPage(null); }, [loadPage]);

  const markRead = async (n) => {
    if (!n.read_at) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      try {
        await fetch(apiUrl(`/api/notifications/${n.id}/read`), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* ignore */ }
    }
    const target = notificationLink(n);
    if (target) navigate(target);
  };

  const markAllRead = async () => {
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })));
    try {
      await fetch(apiUrl('/api/notifications/mark-all-read'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* ignore */ }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Notifications</h1>
        <Button variant="outline" size="sm" icon={CheckCheck} onClick={markAllRead}>Mark all as read</Button>
      </div>

      {error && <Banner tone="danger" className="mb-4">{error}</Banner>}

      {!loading && items.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications yet" description="New issues, completed indexes, and team activity will show up here." className="py-24" />
      ) : (
        <div className="divide-y divide-surface-800 overflow-hidden rounded-xl border border-surface-800 bg-surface-900">
          {items.map((n) => {
            const Icon = TYPE_META[n.type]?.icon || Bell;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => markRead(n)}
                className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-800 ${n.read_at ? 'opacity-60' : ''}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[n.severity] || 'bg-gray-500'}`} />
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-gray-200">{notificationText(n)}</span>
                  <span className="text-xs text-gray-500">{TYPE_META[n.type]?.label || n.type} · {formatDate(n.created_at)}</span>
                </span>
                {!n.read_at && <span className="mt-1 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-300">New</span>}
              </button>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="mt-4 text-center">
          <Button variant="outline" loading={loading} onClick={() => loadPage(cursor)}>Load more</Button>
        </div>
      )}
    </div>
  );
}
