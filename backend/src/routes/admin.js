const express          = require('express');
const router           = express.Router();
const usageController  = require('../controllers/usageController');
const { requireAuth }  = require('../middleware/auth');

// Aggregate usage across all users — gated by ADMIN_USER_IDS env var
router.get('/usage', requireAuth, usageController.getAdminUsage);

module.exports = router;
