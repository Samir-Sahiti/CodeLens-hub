const express          = require('express');
const router           = express.Router();
const reviewController = require('../controllers/reviewController');
const { requireAuth }  = require('../middleware/auth');
const { aiRateLimit }  = require('../middleware/aiRateLimit');

// Whole-repo security audit endpoints must be registered before /:repoId.
router.post('/:repoId/security-audit', requireAuth, aiRateLimit, reviewController.runSecurityAudit);
router.get('/:repoId/security-audits', requireAuth, reviewController.listSecurityAudits);
router.get('/:repoId/security-audits/:auditId', requireAuth, reviewController.getSecurityAudit);

// POST /api/review/:repoId   body: { snippet, context?, mode?, filePath? }
router.post('/:repoId', requireAuth, aiRateLimit, reviewController.review);

module.exports = router;
