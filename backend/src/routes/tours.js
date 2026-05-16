const express = require('express');
const router = express.Router();
const toursController = require('../controllers/toursController');
const { requireAuth } = require('../middleware/auth');
const { aiRateLimit } = require('../middleware/aiRateLimit');

router.post('/:repoId/tours/generate', requireAuth, aiRateLimit, toursController.generateTour);
router.get('/:repoId/tours', requireAuth, toursController.listTours);
router.patch('/:repoId/tours/:tourId', requireAuth, toursController.updateTour); // US-060
router.post('/:repoId/tours/:tourId/fork', requireAuth, toursController.forkTour); // US-061
router.get('/:repoId/tours/:tourId/share-impact', requireAuth, toursController.getShareImpact); // US-061
router.delete('/:repoId/tours/:tourId', requireAuth, toursController.deleteTour);

module.exports = router;
