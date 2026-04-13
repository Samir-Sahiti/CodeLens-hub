const express        = require('express');
const router         = express.Router();
const reviewController = require('../controllers/reviewController');
const { requireAuth }  = require('../middleware/auth');

// POST /api/review/:repoId   body: { snippet, context?, mode? }
router.post('/:repoId', requireAuth, reviewController.review);

module.exports = router;
