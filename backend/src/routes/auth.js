const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

// Upsert profile row after GitHub OAuth (stores provider_token)
router.post('/profile', requireAuth, authController.upsertProfile);

// Return current user from JWT
router.get('/me', requireAuth, authController.getMe);

// Mark static onboarding guide as dismissed
router.post('/onboarding-seen', requireAuth, authController.markOnboardingSeen);

// Sign-out (no-op server-side — client clears its own session)
router.post('/signout', authController.signOut);

module.exports = router;
