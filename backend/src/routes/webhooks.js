const express = require('express');
const router = express.Router();
const { handleGitHubPush } = require('../controllers/webhookController');

// Use express.raw so that the raw Buffer body is available for HMAC validation.
// This must be set per-route, not globally, to avoid breaking the rest of the API.
router.post('/github', express.raw({ type: 'application/json' }), handleGitHubPush);

module.exports = router;
