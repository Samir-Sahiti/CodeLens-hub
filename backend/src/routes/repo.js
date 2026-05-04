const express = require('express');
const router = express.Router();
const repoController = require('../controllers/repoController');
const { requireAuth } = require('../middleware/auth');
const multer = require('multer');
const os = require('os');
const path = require('path');

const upload = multer({
  dest: path.join(os.tmpdir(), 'codelens-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Create a new GitHub repository connection
router.post('/', requireAuth, repoController.connectRepo);

// Upload a local project zip
router.post('/upload', requireAuth, upload.single('repoZip'), repoController.uploadRepo);

// List repositories for the current usericated user
router.get('/', requireAuth, repoController.listRepos);

// Get indexing status for a repo
router.get('/:repoId/status', requireAuth, repoController.getStatus);

// Get full analysis data (nodes, edges, issues)
router.get('/:repoId/analysis', requireAuth, repoController.getAnalysisData);

// Re-trigger indexing on a repository
router.post('/:repoId/reindex', requireAuth, repoController.reindexRepo);

// Delete a repo and its index
router.delete('/:repoId', requireAuth, repoController.deleteRepo);

// Update mutable repo fields (e.g. auto_sync_enabled)
router.patch('/:repoId', requireAuth, repoController.updateRepo);

// Generate (or regenerate) a webhook secret for a GitHub repo — secret shown once
router.get('/:repoId/webhook', requireAuth, repoController.generateWebhook);

// Fetch concatenated source content for a file from code_chunks
router.get('/:repoId/file', requireAuth, repoController.getFileContent);

// Fetch parsed dependency manifest data for the Dependencies tab (US-045)
router.get('/:repoId/dependencies', requireAuth, repoController.getDependencies);

// Fetch file churn data for the hotspot overlay (US-050)
router.get('/:repoId/churn', requireAuth, repoController.getChurn);

// Fetch duplicate code clusters (US-052)
router.get('/:repoId/duplication', requireAuth, repoController.getDuplication);

// List branches for the branch picker (US-051)
router.get('/:repoId/branches', requireAuth, repoController.getBranches);

// Compute or retrieve cached architectural diff between two refs (US-051)
router.get('/:repoId/diff', requireAuth, repoController.getDiff);

module.exports = router;
