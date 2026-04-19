const express = require('express');
const router = express.Router();
const analysisController = require('../controllers/analysisController');
const { requireAuth } = require('../middleware/auth');

// Get the full dependency graph for a repo
router.get('/:repoId/graph', requireAuth, analysisController.getDependencyGraph);

// Get complexity metrics table for all files
router.get('/:repoId/metrics', requireAuth, analysisController.getMetrics);

// Get architectural issues (circular deps, god files, dead code, etc.)
router.get('/:repoId/issues', requireAuth, analysisController.getIssues);

// Suppress a specific issue (false positive)
router.post('/:repoId/issues/suppress', requireAuth, analysisController.suppressIssue);

// Change impact analysis — blast radius for a specific file
router.get('/:repoId/impact/:filePath(*)', requireAuth, analysisController.getImpact);

module.exports = router;
