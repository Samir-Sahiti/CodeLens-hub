const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

// Upsert profile row after GitHub OAuth (stores provider_token)
router.post('/profile', requireAuth, authController.upsertProfile);

// Return current user from JWT
router.get('/me', requireAuth, authController.getMe);

// Sign-out (no-op server-side — client clears its own session)
router.post('/signout', authController.signOut);

module.exports = router;
