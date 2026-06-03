const {
  getOrCreateNotificationPreferences,
  updateNotificationPreferences,
} = require('../services/notificationPreferences');
const {
  runDailyDigest,
  sendImmediateCriticalEmailForNotificationId,
  unsubscribeWithToken,
} = require('../services/notificationEmail');

const getNotificationPreferences = async (req, res) => {
  const preferences = await getOrCreateNotificationPreferences(req.user.id);
  res.json(preferences);
};

const patchNotificationPreferences = async (req, res) => {
  try {
    const preferences = await updateNotificationPreferences(req.user.id, req.body || {});
    res.json(preferences);
  } catch (err) {
    if (/email_digest_hour/.test(err.message || '')) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
};

const unsubscribeNotifications = async (req, res) => {
  try {
    await unsubscribeWithToken(req.query.token);
    res.type('html').send('<!doctype html><html><body><p>Email notifications are now disabled.</p></body></html>');
  } catch {
    res.status(400).type('html').send('<!doctype html><html><body><p>Invalid or expired unsubscribe link.</p></body></html>');
  }
};

const runDigestJob = async (req, res) => {
  const expected = process.env.NOTIFICATION_DIGEST_SECRET;
  if (!expected || req.headers['x-digest-secret'] !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await runDailyDigest();
  res.json({ ok: true, ...result });
};

const runImmediateNotificationEmailJob = async (req, res) => {
  const expected = process.env.NOTIFICATION_EMAIL_TRIGGER_SECRET;
  if (!expected || req.headers['x-notification-email-secret'] !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const sent = await sendImmediateCriticalEmailForNotificationId(req.body?.notification_id);
  res.json({ ok: true, sent });
};

module.exports = {
  getNotificationPreferences,
  patchNotificationPreferences,
  runImmediateNotificationEmailJob,
  runDigestJob,
  unsubscribeNotifications,
};
