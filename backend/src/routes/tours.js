const express = require('express');
const router = express.Router();
const toursController = require('../controllers/toursController');
const { requireAuth } = require('../middleware/auth');
const { aiRateLimit } = require('../middleware/aiRateLimit');

router.post('/:repoId/tours/generate', requireAuth, aiRateLimit, toursController.generateTour);

module.exports = router;
