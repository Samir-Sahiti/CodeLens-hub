const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notificationsController');
const { requireAuth } = require('../middleware/auth');

// US-077: in-app notification feed (all user-scoped)
router.get('/', requireAuth, notificationsController.listNotifications);
router.get('/unread-count', requireAuth, notificationsController.unreadCount);
router.post('/mark-all-read', requireAuth, notificationsController.markAllRead);
router.post('/:id/read', requireAuth, notificationsController.markRead);

module.exports = router;
