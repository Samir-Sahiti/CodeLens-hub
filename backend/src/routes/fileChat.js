const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const fileChatController = require('../controllers/fileChatController');

// Targeted file-scoped chat (no RAG similarity search)
// POST /api/file-chat/:repoId   body: { filePath: string, query: string, includeImports?: boolean }
router.post('/:repoId', requireAuth, fileChatController.chatWithFile);

module.exports = router;

