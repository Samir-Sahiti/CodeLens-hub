/**
 * US-077 — in-app notification feed endpoints. All rows are user-scoped; the
 * service-role client is used but every query filters on req.user.id so a user
 * can only ever read/modify their own notifications.
 */
const { supabaseAdmin } = require('../db/supabase');

// GET /api/notifications?limit&before
const listNotifications = async (req, res) => {
  const userId = req.user.id;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const before = req.query.before;

  let query = supabaseAdmin
    .from('notifications')
    .select('id, repo_id, type, severity, payload_json, link_url, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) {
    console.error('[notifications.list] Failed:', error.message);
    return res.status(500).json({ error: 'Failed to load notifications' });
  }

  const rows = data || [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.created_at : null;
  return res.json({ notifications: page, next_cursor: nextCursor, has_more: hasMore });
};

// GET /api/notifications/unread-count
const unreadCount = async (req, res) => {
  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id)
    .is('read_at', null);
  if (error) {
    console.error('[notifications.unread-count] Failed:', error.message);
    return res.status(500).json({ error: 'Failed to load unread count' });
  }
  return res.json({ unread: count || 0 });
};

// POST /api/notifications/:id/read
const markRead = async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', req.user.id)
    .is('read_at', null)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[notifications.read] Failed:', error.message);
    return res.status(500).json({ error: 'Failed to mark notification read' });
  }
  return res.json({ ok: true, id: data?.id || id });
};

// POST /api/notifications/mark-all-read
const markAllRead = async (req, res) => {
  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', req.user.id)
    .is('read_at', null);
  if (error) {
    console.error('[notifications.mark-all-read] Failed:', error.message);
    return res.status(500).json({ error: 'Failed to mark all read' });
  }
  return res.json({ ok: true });
};

module.exports = { listNotifications, unreadCount, markRead, markAllRead };
