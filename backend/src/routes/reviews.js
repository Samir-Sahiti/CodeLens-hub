const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { requireAuth } = require('../middleware/auth');

router.get('/:reviewId', requireAuth, reviewController.getPrReviewDetail);

module.exports = router;
