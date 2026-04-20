/**
 * AI endpoint rate limiting (US-042)
 *
 * Enforces:
 *   - MAX_RPM  requests per minute per user  (default 30)
 *   - MAX_RPH  requests per hour  per user   (default 500)
 *   - MAX_DAILY_TOKENS_PER_USER tokens/day   (default 500 000)
 *
 * Request-count windows are tracked in-memory (single-instance).
 * Token budget is persisted in Supabase api_usage and survives restarts.
 */

const { supabaseAdmin } = require('../db/supabase');

const MAX_RPM    = parseInt(process.env.MAX_RPM                 || '30',     10);
const MAX_RPH    = parseInt(process.env.MAX_RPH                 || '500',    10);
const MAX_TOKENS = parseInt(process.env.MAX_DAILY_TOKENS_PER_USER || '500000', 10);

// In-memory sliding-window counters keyed by `userId:windowId`
const minuteCounters = new Map();
const hourCounters   = new Map();

// Prune expired entries every 5 minutes to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of minuteCounters) if (now > v.expiry) minuteCounters.delete(k);
  for (const [k, v] of hourCounters)   if (now > v.expiry) hourCounters.delete(k);
}, 5 * 60 * 1000);

async function dailyTokensUsed(userId) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('api_usage')
    .select('prompt_tokens, completion_tokens, embedding_tokens')
    .eq('user_id', userId)
    .gte('created_at', since);

  if (error) return 0; // fail open
  return (data || []).reduce(
    (sum, r) => sum + (r.prompt_tokens || 0) + (r.completion_tokens || 0) + (r.embedding_tokens || 0),
    0
  );
}

const aiRateLimit = async (req, res, next) => {
  const userId = req.user?.id;
  if (!userId) return next();

  const now         = Date.now();
  const currentMin  = Math.floor(now / 60_000);
  const currentHour = Math.floor(now / 3_600_000);

  // ── Per-minute check ────────────────────────────────────────────────────────
  const minKey    = `${userId}:${currentMin}`;
  const minEntry  = minuteCounters.get(minKey) || { count: 0, expiry: (currentMin + 1) * 60_000 };
  if (minEntry.count >= MAX_RPM) {
    return res.status(429).json({
      error: `Rate limit exceeded: max ${MAX_RPM} requests per minute.`,
      retryAfterSeconds: Math.ceil((minEntry.expiry - now) / 1000),
    });
  }
  minEntry.count++;
  minuteCounters.set(minKey, minEntry);

  // ── Per-hour check ──────────────────────────────────────────────────────────
  const hourKey   = `${userId}:${currentHour}`;
  const hourEntry = hourCounters.get(hourKey) || { count: 0, expiry: (currentHour + 1) * 3_600_000 };
  if (hourEntry.count >= MAX_RPH) {
    return res.status(429).json({
      error: `Rate limit exceeded: max ${MAX_RPH} requests per hour.`,
      retryAfterSeconds: Math.ceil((hourEntry.expiry - now) / 1000),
    });
  }
  hourEntry.count++;
  hourCounters.set(hourKey, hourEntry);

  // ── Daily token budget ──────────────────────────────────────────────────────
  const used = await dailyTokensUsed(userId);
  if (used >= MAX_TOKENS) {
    // Seconds until midnight UTC
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    return res.status(429).json({
      error: `Daily token budget exceeded (${used.toLocaleString()} / ${MAX_TOKENS.toLocaleString()} tokens used today).`,
      retryAfterSeconds: Math.ceil((midnight.getTime() - now) / 1000),
    });
  }

  next();
};

module.exports = { aiRateLimit };
