const express = require('express');
const router = express.Router();
const toursController = require('../controllers/toursController');
const { requireAuth } = require('../middleware/auth');
const { aiRateLimit } = require('../middleware/aiRateLimit');

router.post('/:repoId/tours/generate', requireAuth, aiRateLimit, toursController.generateTour);
router.get('/:repoId/tours', requireAuth, toursController.listTours);
router.delete('/:repoId/tours/:tourId', requireAuth, toursController.deleteTour);

module.exports = router;
