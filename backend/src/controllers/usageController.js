/**
 * Usage controller (US-042)
 *
 * GET /api/usage/today  — current user's daily token consumption
 * GET /api/admin/usage  — aggregate across all users (admin only)
 */

const { supabaseAdmin } = require('../db/supabase');

const MAX_TOKENS  = parseInt(process.env.MAX_DAILY_TOKENS_PER_USER || '500000', 10);
const ADMIN_IDS   = new Set((process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean));

/** GET /api/usage/today */
const getTodayUsage = async (req, res) => {
  const userId = req.user.id;
  const since  = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('api_usage')
    .select('prompt_tokens, completion_tokens, embedding_tokens')
    .eq('user_id', userId)
    .gte('created_at', since);

  if (error) return res.status(500).json({ error: 'Failed to fetch usage data' });

  const used = (data || []).reduce(
    (sum, r) => sum + (r.prompt_tokens || 0) + (r.completion_tokens || 0) + (r.embedding_tokens || 0),
    0
  );

  res.json({ used, limit: MAX_TOKENS });
};

/** GET /api/admin/usage */
const getAdminUsage = async (req, res) => {
  if (!ADMIN_IDS.has(req.user.id)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('api_usage')
    .select('user_id, endpoint, provider, prompt_tokens, completion_tokens, embedding_tokens, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch admin usage data' });

  // Aggregate per user
  const byUser = {};
  for (const row of data || []) {
    if (!byUser[row.user_id]) byUser[row.user_id] = { user_id: row.user_id, total_tokens: 0, requests: 0 };
    byUser[row.user_id].total_tokens +=
      (row.prompt_tokens || 0) + (row.completion_tokens || 0) + (row.embedding_tokens || 0);
    byUser[row.user_id].requests++;
  }

  res.json({
    period: '24h',
    rows: data || [],
    by_user: Object.values(byUser).sort((a, b) => b.total_tokens - a.total_tokens),
  });
};

module.exports = { getTodayUsage, getAdminUsage };
