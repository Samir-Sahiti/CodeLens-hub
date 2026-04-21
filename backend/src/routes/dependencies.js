const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDependencies } = require('../controllers/dependenciesController');

// GET /api/repos/:repoId/dependencies
router.get('/:repoId/dependencies', requireAuth, getDependencies);

module.exports = router;
