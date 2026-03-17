const express = require('express');
const router = express.Router();
const repoController = require('../controllers/repoController');
const { requireAuth } = require('../middleware/auth');

// Connect a GitHub repository and trigger indexing
router.post('/', requireAuth, repoController.connectRepo);

// List all repos for the authenticated user
router.get('/', requireAuth, repoController.listRepos);

// Get indexing status for a repo
router.get('/:repoId/status', requireAuth, repoController.getStatus);

// Delete a repo and its index
router.delete('/:repoId', requireAuth, repoController.deleteRepo);

module.exports = router;
