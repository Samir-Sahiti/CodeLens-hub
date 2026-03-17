const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { requireAuth } = require('../middleware/auth');

// Natural language search over an indexed repo (RAG)
router.post('/:repoId', requireAuth, searchController.search);

module.exports = router;
