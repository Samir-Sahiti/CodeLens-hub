const express          = require('express');
const router           = express.Router();
const reviewController = require('../controllers/reviewController');
const { requireAuth }  = require('../middleware/auth');
const { aiRateLimit }  = require('../middleware/aiRateLimit');

// Whole-repo security audit endpoints must be registered before /:repoId.
router.post('/:repoId/security-audit', requireAuth, aiRateLimit, reviewController.runSecurityAudit);
router.get('/:repoId/security-audits', requireAuth, reviewController.listSecurityAudits);
router.get('/:repoId/security-audits/:auditId', requireAuth, reviewController.getSecurityAudit);
router.post('/:repoId/duplication-refactor', requireAuth, aiRateLimit, reviewController.duplicationRefactor);

// US-064: refactor proposal generation. Optional ?regenerate=true skips the cache.
router.post('/:repoId/issues/:issueId/proposals', requireAuth, aiRateLimit, reviewController.generateProposal);
router.patch('/:repoId/issues/:issueId/proposals/:proposalId', requireAuth, reviewController.updateProposalStatus);

// POST /api/review/:repoId   body: { snippet, context?, mode?, filePath? }
router.post('/:repoId', requireAuth, aiRateLimit, reviewController.review);

module.exports = router;
