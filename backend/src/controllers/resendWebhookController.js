const { supabaseAdmin } = require('../db/supabase');
const { enqueueNotification } = require('../services/notifications');
const {
  getOrCreateNotificationPreferences,
  updateNotificationPreferences,
} = require('../services/notificationPreferences');
const crypto = require('crypto');

function verifyResendSignature(req) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;
  const id = req.headers['svix-id'];
  const timestamp = req.headers['svix-timestamp'];
  const signatureHeader = req.headers['svix-signature'];
  if (!id || !timestamp || !signatureHeader || !Buffer.isBuffer(req.body)) return false;

  const rawSecret = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let key;
  try {
    key = Buffer.from(rawSecret, 'base64');
  } catch {
    return false;
  }
  const signedPayload = Buffer.concat([
    Buffer.from(`${id}.${timestamp}.`, 'utf8'),
    req.body,
  ]);
  const expected = crypto.createHmac('sha256', key).update(signedPayload).digest('base64');
  return String(signatureHeader).split(' ').some((part) => {
    const value = part.includes(',') ? part.split(',').pop() : part;
    try {
      return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

function tagValue(tags, name) {
  if (!tags) return null;
  if (!Array.isArray(tags)) return tags[name] || null;
  return tags.find((tag) => tag?.name === name)?.value || null;
}

function parsePayload(req) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {});
  return raw ? JSON.parse(raw) : {};
}

function eventKind(payload = {}) {
  return String(payload.type || payload.event || payload.data?.type || '').toLowerCase();
}

function data(payload = {}) {
  return payload.data || payload;
}

function notificationIdFrom(payload = {}) {
  const d = data(payload);
  return d.notification_id || tagValue(d.tags, 'notification_id') || d.metadata?.notification_id || null;
}

function userIdFrom(payload = {}) {
  const d = data(payload);
  return d.user_id || tagValue(d.tags, 'user_id') || d.metadata?.user_id || null;
}

async function disableAfterHardBounces(userId) {
  if (!userId) return;
  const { count, error } = await supabaseAdmin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('notification_email_status', 'hard_bounce');
  if (error || (count || 0) < 2) return;

  await getOrCreateNotificationPreferences(userId);
  await updateNotificationPreferences(userId, { email_enabled: false });
  await enqueueNotification({
    user_ids: [userId],
    type: 'webhook_paused',
    severity: 'warning',
    payload: { message: 'Email notifications were disabled after 2 hard bounces.' },
    link_url: '/settings/notifications',
    dedup_key: 'email_disabled_after_hard_bounces',
    force_in_app: true,
  });
}

const handleResendWebhook = async (req, res) => {
  if (!verifyResendSignature(req)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  let payload;
  try {
    payload = parsePayload(req);
  } catch {
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }

  const kind = eventKind(payload);
  const hardBounce = kind.includes('bounce');
  const complaint = kind.includes('complain');
  const status = hardBounce ? 'hard_bounce' : complaint ? 'complaint' : kind || 'event';
  const notificationId = notificationIdFrom(payload);
  let userId = userIdFrom(payload);

  if (notificationId) {
    const { data: updated } = await supabaseAdmin
      .from('notifications')
      .update({ notification_email_status: status })
      .eq('id', notificationId)
      .select('user_id')
      .maybeSingle();
    userId = userId || updated?.user_id;
  }

  if (!notificationId && userId && (hardBounce || complaint)) {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await supabaseAdmin
      .from('notifications')
      .update({ notification_email_status: status })
      .eq('user_id', userId)
      .eq('notification_email_status', 'sent')
      .gte('created_at', since);
  }

  if ((hardBounce || complaint) && userId) {
    await disableAfterHardBounces(userId);
  }

  return res.json({ ok: true });
};

module.exports = { handleResendWebhook };
