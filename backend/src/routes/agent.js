const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const { requireAuth } = require('../middleware/auth');
const { aiRateLimit } = require('../middleware/aiRateLimit');

// Per-repo endpoints
router.post('/repos/:repoId/agent/chat', requireAuth, aiRateLimit, agentController.chat);
router.get('/repos/:repoId/agent/conversations', requireAuth, agentController.listConversations);
router.get('/repos/:repoId/agent/suggestions', requireAuth, agentController.getSuggestions);

// Conversation-scoped endpoints
router.get('/agent/conversations/:id', requireAuth, agentController.getConversation);
router.patch('/agent/conversations/:id', requireAuth, agentController.updateConversation);
router.delete('/agent/conversations/:id', requireAuth, agentController.deleteConversation);

module.exports = router;
