const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { requireAuth }  = require('../middleware/auth');
const { aiRateLimit }  = require('../middleware/aiRateLimit');

// Natural language search over an indexed repo (RAG)
// POST /api/search/:repoId   body: { query: string }
// Streams back SSE events: { type: 'sources'|'chunk'|'done'|'error', ... }
router.post('/:repoId', requireAuth, aiRateLimit, searchController.search);

module.exports = router;