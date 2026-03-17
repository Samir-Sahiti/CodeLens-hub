const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// GitHub OAuth flow
router.get('/github', authController.githubRedirect);
router.get('/github/callback', authController.githubCallback);

// Validate session / get current user
router.get('/me', authController.getMe);

// Sign out
router.post('/signout', authController.signOut);

module.exports = router;
