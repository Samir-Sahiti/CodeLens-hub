const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const teamController = require('../controllers/teamController');

router.post('/',                    requireAuth, teamController.createTeam);
router.get('/',                     requireAuth, teamController.listTeams);
router.post('/:teamId/repos',       requireAuth, teamController.addRepoToTeam);
router.get('/:teamId/repos',        requireAuth, teamController.listTeamRepos);

module.exports = router;
