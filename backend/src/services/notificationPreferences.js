const { supabaseAdmin } = require('../db/supabase');

const NOTIFICATION_TYPE_DEFAULTS = {
  new_critical_issue: { in_app: true, email: true },
  new_vulnerability: { in_app: true, email: true },
  index_ready: { in_app: true, email: false },
  index_failed: { in_app: true, email: true },
  pr_review_ready: { in_app: true, email: true },
  proposal_shared: { in_app: true, email: false },
  tour_shared: { in_app: true, email: false },
  webhook_paused: { in_app: true, email: true },
};

const DEFAULT_PREFERENCES = {
  in_app_enabled: true,
  email_enabled: false,
  email_digest_hour: 9,
  email_immediate_critical: true,
  per_type_json: NOTIFICATION_TYPE_DEFAULTS,
  timezone: 'UTC',
};

function mergePerType(overrides = {}) {
  const merged = {};
  for (const [type, defaults] of Object.entries(NOTIFICATION_TYPE_DEFAULTS)) {
    const override = overrides?.[type] || {};
    merged[type] = {
      in_app: override.in_app == null ? defaults.in_app : Boolean(override.in_app),
      email: override.email == null ? defaults.email : Boolean(override.email),
    };
  }
  return merged;
}

function normalizePreferences(row = {}) {
  return {
    user_id: row.user_id,
    in_app_enabled: row.in_app_enabled == null ? DEFAULT_PREFERENCES.in_app_enabled : Boolean(row.in_app_enabled),
    email_enabled: row.email_enabled == null ? DEFAULT_PREFERENCES.email_enabled : Boolean(row.email_enabled),
    email_digest_hour: Number.isInteger(Number(row.email_digest_hour))
      ? Math.max(0, Math.min(23, Number(row.email_digest_hour)))
      : DEFAULT_PREFERENCES.email_digest_hour,
    email_immediate_critical: row.email_immediate_critical == null
      ? DEFAULT_PREFERENCES.email_immediate_critical
      : Boolean(row.email_immediate_critical),
    per_type_json: mergePerType(row.per_type_json),
    timezone: row.timezone || DEFAULT_PREFERENCES.timezone,
  };
}

async function getOrCreateNotificationPreferences(userId) {
  const { data: existing, error } = await supabaseAdmin
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (existing) return normalizePreferences(existing);

  const insert = {
    user_id: userId,
    in_app_enabled: DEFAULT_PREFERENCES.in_app_enabled,
    email_enabled: DEFAULT_PREFERENCES.email_enabled,
    email_digest_hour: DEFAULT_PREFERENCES.email_digest_hour,
    email_immediate_critical: DEFAULT_PREFERENCES.email_immediate_critical,
    per_type_json: {},
    timezone: DEFAULT_PREFERENCES.timezone,
  };
  const { data, error: insertError } = await supabaseAdmin
    .from('notification_preferences')
    .insert(insert)
    .select('*')
    .single();
  if (insertError) throw insertError;
  return normalizePreferences(data || insert);
}

function sanitizePatch(body = {}) {
  const patch = {};
  if ('in_app_enabled' in body) patch.in_app_enabled = Boolean(body.in_app_enabled);
  if ('email_enabled' in body) patch.email_enabled = Boolean(body.email_enabled);
  if ('email_digest_hour' in body) {
    const hour = Number(body.email_digest_hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new Error('email_digest_hour must be an integer from 0 to 23');
    }
    patch.email_digest_hour = hour;
  }
  if ('email_immediate_critical' in body) patch.email_immediate_critical = Boolean(body.email_immediate_critical);
  if ('per_type_json' in body) patch.per_type_json = mergePerType(body.per_type_json);
  if ('timezone' in body) patch.timezone = String(body.timezone || 'UTC');
  return patch;
}

async function updateNotificationPreferences(userId, body) {
  const patch = sanitizePatch(body);
  await getOrCreateNotificationPreferences(userId);
  const { data, error } = await supabaseAdmin
    .from('notification_preferences')
    .update(patch)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return normalizePreferences(data);
}

function channelEnabled(preferences, type, channel) {
  const normalized = normalizePreferences(preferences || {});
  if (channel === 'in_app' && !normalized.in_app_enabled) return false;
  if (channel === 'email' && !normalized.email_enabled) return false;
  return Boolean(normalized.per_type_json?.[type]?.[channel]);
}

module.exports = {
  DEFAULT_PREFERENCES,
  NOTIFICATION_TYPE_DEFAULTS,
  channelEnabled,
  getOrCreateNotificationPreferences,
  mergePerType,
  normalizePreferences,
  updateNotificationPreferences,
};
