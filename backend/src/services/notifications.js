/**
 * US-077 — in-app notification dispatch.
 *
 * enqueueNotification() writes one row per recipient. For repeatable events
 * (new_critical_issue / new_vulnerability) pass a `dedup_key` so re-indexing a
 * repo with pre-existing issues does not spam duplicate notifications — any
 * (user, repo, type, dedup_key) seen in the last 30 days is skipped.
 *
 * All emission is best-effort: callers wrap in try/catch and never block their
 * pipeline on a notification failure.
 */
const { supabaseAdmin } = require('../db/supabase');
const { withSupabaseRetry } = require('../lib/dbHelpers');

const DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Resolve the set of user ids who can see a repo: the owner plus members of any
 * team the repo is shared with.
 */
async function recipientsForRepo(repoId) {
  const ids = new Set();
  try {
    const { data: repo } = await supabaseAdmin
      .from('repositories')
      .select('user_id')
      .eq('id', repoId)
      .maybeSingle();
    if (repo?.user_id) ids.add(repo.user_id);

    const { data: teamRepos } = await supabaseAdmin
      .from('team_repositories')
      .select('team_id')
      .eq('repo_id', repoId);
    const teamIds = (teamRepos || []).map((row) => row.team_id).filter(Boolean);
    if (teamIds.length > 0) {
      const { data: members } = await supabaseAdmin
        .from('team_members')
        .select('user_id')
        .in('team_id', teamIds);
      for (const member of members || []) {
        if (member.user_id) ids.add(member.user_id);
      }
    }
  } catch (err) {
    console.warn('[notifications] recipientsForRepo failed:', err.message || err);
  }
  return [...ids];
}

/**
 * Insert a notification for each recipient.
 * @param {Object} opts
 * @param {string[]} opts.user_ids - recipient user ids
 * @param {string} [opts.repo_id]
 * @param {string} opts.type - notification_type enum value
 * @param {string} [opts.severity] - 'info' | 'warning' | 'critical'
 * @param {Object} [opts.payload] - type-specific data (stored in payload_json)
 * @param {string} [opts.link_url] - deep link into the app
 * @param {string} [opts.dedup_key] - if set, skip users notified for the same
 *   (repo, type, dedup_key) within the last 30 days
 * @returns {Promise<number>} number of rows inserted
 */
async function enqueueNotification({ user_ids, repo_id = null, type, severity = 'info', payload = {}, link_url = null, dedup_key = null }) {
  try {
    let recipients = [...new Set((user_ids || []).filter(Boolean))];
    if (recipients.length === 0 || !type) return 0;

    if (dedup_key) {
      const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
      const { data: existing } = await supabaseAdmin
        .from('notifications')
        .select('user_id, payload_json')
        .eq('repo_id', repo_id)
        .eq('type', type)
        .gte('created_at', since)
        .in('user_id', recipients);
      const seen = new Set(
        (existing || [])
          .filter((row) => row.payload_json?.dedup_key === dedup_key)
          .map((row) => row.user_id),
      );
      recipients = recipients.filter((id) => !seen.has(id));
      if (recipients.length === 0) return 0;
    }

    const payloadJson = dedup_key ? { ...payload, dedup_key } : payload;
    const rows = recipients.map((userId) => ({
      user_id: userId,
      repo_id,
      type,
      severity,
      payload_json: payloadJson,
      link_url,
    }));

    await withSupabaseRetry(
      () => supabaseAdmin.from('notifications').insert(rows),
      { label: 'notifications.insert' },
    );
    return rows.length;
  } catch (err) {
    console.warn('[notifications] enqueueNotification failed:', err.message || err);
    return 0;
  }
}

module.exports = { enqueueNotification, recipientsForRepo };
