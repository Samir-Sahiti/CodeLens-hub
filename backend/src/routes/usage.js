const express          = require('express');
const router           = express.Router();
const usageController  = require('../controllers/usageController');
const { requireAuth }  = require('../middleware/auth');

// Current user's daily token consumption
router.get('/today', requireAuth, usageController.getTodayUsage);

module.exports = router;
