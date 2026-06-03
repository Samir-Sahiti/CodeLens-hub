const express = require('express');
const router = express.Router();
const preferencesController = require('../controllers/preferencesController');
const { requireAuth } = require('../middleware/auth');

router.get('/notifications/unsubscribe', preferencesController.unsubscribeNotifications);
router.post('/notifications/digest/run', preferencesController.runDigestJob);
router.post('/notifications/immediate/run', preferencesController.runImmediateNotificationEmailJob);
router.get('/notifications', requireAuth, preferencesController.getNotificationPreferences);
router.patch('/notifications', requireAuth, preferencesController.patchNotificationPreferences);

module.exports = router;
