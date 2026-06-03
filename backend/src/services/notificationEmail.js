const crypto = require('crypto');
const { supabaseAdmin } = require('../db/supabase');
const { sendEmail } = require('./emailProvider');
const {
  channelEnabled,
  getOrCreateNotificationPreferences,
  normalizePreferences,
} = require('./notificationPreferences');

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signJwt(payload, expiresInSeconds = 30 * 24 * 60 * 60) {
  const secret = process.env.EMAIL_UNSUBSCRIBE_JWT_SECRET || process.env.CI_TOKEN_HMAC_SECRET || 'dev-email-unsubscribe-secret';
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function verifyJwt(token) {
  const secret = process.env.EMAIL_UNSUBSCRIBE_JWT_SECRET || process.env.CI_TOKEN_HMAC_SECRET || 'dev-email-unsubscribe-secret';
  const [header, body, signature] = String(token || '').split('.');
  if (!header || !body || !signature) throw new Error('Invalid token');
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Invalid token');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired token');
  return payload;
}

function appUrl(path = '') {
  return `${process.env.FRONTEND_URL || 'http://localhost:3000'}${path}`;
}

function apiUrl(path = '') {
  return `${process.env.PUBLIC_API_URL || process.env.API_BASE_URL || process.env.BACKEND_URL || process.env.FRONTEND_URL || 'http://localhost:3001'}${path}`;
}

async function getUserEmail(userId) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error) {
    console.warn(`[email] Could not resolve user email for ${userId}: ${error.message}`);
    return null;
  }
  return data?.user?.email || null;
}

function notificationTitle(n = {}) {
  const payload = n.payload_json || {};
  if (payload.message) return payload.message;
  if (n.type === 'new_critical_issue') return `Critical issue in ${payload.file_path || 'a file'}`;
  if (n.type === 'new_vulnerability') return 'Vulnerable dependency detected';
  if (n.type === 'index_ready') return 'Indexing finished';
  if (n.type === 'index_failed') return 'Indexing failed';
  if (n.type === 'pr_review_ready') return `PR #${payload.pr_number} review ready`;
  return String(n.type || 'Notification').replaceAll('_', ' ');
}

function unsubscribeUrl(userId) {
  return apiUrl(`/api/preferences/notifications/unsubscribe?token=${encodeURIComponent(signJwt({ sub: userId, action: 'unsubscribe' }))}`);
}

function renderEmail({ title, notifications, userId }) {
  const groups = new Map();
  for (const n of notifications || []) {
    const repoName = n.repositories?.full_name || n.repositories?.name || 'Workspace';
    if (!groups.has(repoName)) groups.set(repoName, []);
    groups.get(repoName).push(n);
  }
  const rowsHtml = [...groups.entries()].map(([repoName, items]) => `
    <h2 style="margin:24px 0 8px;font-size:16px;color:#111827;">${escapeHtml(repoName)}</h2>
    <ul style="margin:0;padding:0;list-style:none;">
      ${items.map((n) => `<li style="padding:12px 0;border-top:1px solid #e5e7eb;">
        <div style="font-size:14px;color:#111827;font-weight:600;">${escapeHtml(notificationTitle(n))}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:4px;">${escapeHtml(n.severity || 'info')} · ${new Date(n.created_at).toLocaleString()}</div>
      </li>`).join('')}
    </ul>
  `).join('');
  const textGroups = [...groups.entries()].map(([repoName, items]) => [
    repoName,
    ...items.map((n) => `- ${notificationTitle(n)} (${n.severity || 'info'})`),
  ].join('\n')).join('\n\n');
  const openUrl = appUrl('/notifications');
  const unsub = unsubscribeUrl(userId);
  return {
    subject: title,
    html: `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Inter,Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;">
        <div style="padding:24px;background:#111827;color:#ffffff;">
          <div style="font-size:18px;font-weight:700;">CodeLens</div>
          <div style="font-size:13px;color:#d1d5db;margin-top:4px;">${escapeHtml(title)}</div>
        </div>
        <div style="padding:24px;">
          ${rowsHtml}
          <div style="margin-top:28px;text-align:center;">
            <a href="${openUrl}" style="display:inline-block;border-radius:8px;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 18px;font-weight:700;">Open CodeLens</a>
          </div>
        </div>
        <div style="padding:18px 24px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.6;">
          You are receiving this because email notifications are enabled for CodeLens.
          <a href="${unsub}" style="color:#4f46e5;">Unsubscribe</a>
        </div>
      </div>
    </body></html>`,
    text: `${title}\n\n${textGroups}\n\nOpen CodeLens: ${openUrl}\nUnsubscribe: ${unsub}`,
  };
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function sendImmediateCriticalEmail(notification) {
  if (!notification || notification.severity !== 'critical') return false;
  const prefs = await getOrCreateNotificationPreferences(notification.user_id);
  if (!prefs.email_immediate_critical || !channelEnabled(prefs, notification.type, 'email')) return false;
  return sendNotificationEmail(notification, prefs);
}

async function sendImmediateCriticalEmailForNotificationId(notificationId) {
  if (!notificationId) return false;
  const { data: notification, error } = await supabaseAdmin
    .from('notifications')
    .select('id, user_id, repo_id, type, severity, payload_json, link_url, read_at, created_at, repositories(name, full_name)')
    .eq('id', notificationId)
    .maybeSingle();
  if (error) throw error;
  return sendImmediateCriticalEmail(notification);
}

async function sendNotificationEmail(notification, prefs = null) {
  if (!notification) return false;
  const effectivePrefs = prefs || await getOrCreateNotificationPreferences(notification.user_id);
  if (!channelEnabled(effectivePrefs, notification.type, 'email')) return false;
  const to = await getUserEmail(notification.user_id);
  if (!to) return false;
  const rendered = renderEmail({
    title: 'Critical CodeLens notification',
    notifications: [notification],
    userId: notification.user_id,
  });
  await sendEmail({
    to,
    ...rendered,
    metadata: { notification_id: notification.id, user_id: notification.user_id },
    tags: [
      { name: 'notification_id', value: String(notification.id) },
      { name: 'user_id', value: String(notification.user_id) },
    ],
  });
  if (notification.id) {
    await supabaseAdmin
      .from('notifications')
      .update({ notification_email_status: 'sent' })
      .eq('id', notification.id);
  }
  return true;
}

function localHourForTimezone(timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone || 'UTC',
    }).formatToParts(new Date());
    return Number(parts.find((part) => part.type === 'hour')?.value || 0);
  } catch {
    return new Date().getUTCHours();
  }
}

async function runDailyDigest() {
  const { data: prefsRows, error } = await supabaseAdmin
    .from('notification_preferences')
    .select('*')
    .eq('email_enabled', true);
  if (error) throw error;

  let sent = 0;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  for (const row of prefsRows || []) {
    const prefs = normalizePreferences(row);
    if (localHourForTimezone(prefs.timezone) !== prefs.email_digest_hour) continue;
    const { data: notifications, error: notificationsError } = await supabaseAdmin
      .from('notifications')
      .select('id, user_id, repo_id, type, severity, payload_json, link_url, read_at, created_at, repositories(name, full_name)')
      .eq('user_id', prefs.user_id)
      .is('read_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    if (notificationsError) throw notificationsError;
    const emailItems = (notifications || []).filter((n) => channelEnabled(prefs, n.type, 'email'));
    if (emailItems.length === 0) continue;
    const to = await getUserEmail(prefs.user_id);
    if (!to) continue;
    const rendered = renderEmail({
      title: 'Your CodeLens daily digest',
      notifications: emailItems,
      userId: prefs.user_id,
    });
    await sendEmail({
      to,
      ...rendered,
      metadata: { user_id: prefs.user_id, digest: 'daily' },
      tags: [
        { name: 'user_id', value: String(prefs.user_id) },
        { name: 'digest', value: 'daily' },
      ],
    });
    await supabaseAdmin
      .from('notifications')
      .update({ notification_email_status: 'sent' })
      .in('id', emailItems.map((n) => n.id));
    sent += 1;
  }
  return { sent };
}

async function unsubscribeWithToken(token) {
  const payload = verifyJwt(token);
  if (payload.action !== 'unsubscribe' || !payload.sub) throw new Error('Invalid token');
  await getOrCreateNotificationPreferences(payload.sub);
  const { error } = await supabaseAdmin
    .from('notification_preferences')
    .update({ email_enabled: false })
    .eq('user_id', payload.sub);
  if (error) throw error;
  return payload.sub;
}

module.exports = {
  renderEmail,
  runDailyDigest,
  sendImmediateCriticalEmail,
  sendImmediateCriticalEmailForNotificationId,
  sendNotificationEmail,
  signJwt,
  unsubscribeWithToken,
  verifyJwt,
};
