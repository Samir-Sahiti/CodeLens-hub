const express          = require('express');
const router           = express.Router();
const reviewController = require('../controllers/reviewController');
const { requireAuth }  = require('../middleware/auth');
const { aiRateLimit }  = require('../middleware/aiRateLimit');

// POST /api/review/:repoId   body: { snippet, context?, mode? }
router.post('/:repoId', requireAuth, aiRateLimit, reviewController.review);

module.exports = router;
