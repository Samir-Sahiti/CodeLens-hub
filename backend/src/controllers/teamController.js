/**
 * Team controller — manages teams, membership, and shared repositories.
 */
const { Octokit } = require('octokit');
const { supabaseAdmin } = require('../db/supabase');

/**
 * POST /api/teams
 * Create a team, sync GitHub collaborators for the given repo, and link the repo.
 *
 * Body: { name: string, repoFullName: string }
 */
const createTeam = async (req, res) => {
  const { name, repoFullName } = req.body;
  if (!name || !repoFullName) {
    return res.status(400).json({ error: 'name and repoFullName are required' });
  }

  // Fetch the repo owned by this user
  const { data: repo, error: repoErr } = await supabaseAdmin
    .from('repositories')
    .select('id, name, source')
    .eq('name', repoFullName)
    .eq('user_id', req.user.id)
    .single();

  if (repoErr || !repo) {
    return res.status(404).json({ error: 'Repository not found or you do not own it' });
  }

  if (repo.source !== 'github') {
    return res.status(400).json({ error: 'Teams can only be created for GitHub repositories' });
  }

  // Get the owner's GitHub token from Vault
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('github_token_secret_id, github_username')
    .eq('id', req.user.id)
    .single();

  let githubToken = null;
  if (profile?.github_token_secret_id) {
    const { data: tokenData } = await supabaseAdmin.rpc('get_github_token_secret', {
      secret_id: profile.github_token_secret_id,
    });
    githubToken = tokenData;
  }

  if (!githubToken) {
    return res.status(400).json({ error: 'GitHub token not found or could not be decrypted' });
  }

  // 1. Create the team
  const { data: team, error: teamErr } = await supabaseAdmin
    .from('teams')
    .insert({ name, created_by: req.user.id })
    .select()
    .single();

  if (teamErr) {
    console.error('[createTeam] insert team:', teamErr);
    return res.status(500).json({ error: 'Failed to create team' });
  }

  // 2. Insert creator as owner
  const ownerUsername = profile.github_username || req.user.user_metadata?.user_name || '';
  await supabaseAdmin.from('team_members').insert({
    team_id:         team.id,
    user_id:         req.user.id,
    github_username: ownerUsername,
    role:            'owner',
  });

  // 3. Fetch GitHub collaborators and bulk-insert them as team members
  let collaboratorCount = 0;
  try {
    const [owner, repoName] = repoFullName.split('/');
    const octokit = new Octokit({ auth: githubToken });

    const collaborators = await octokit.paginate(
      octokit.rest.repos.listCollaborators,
      { owner, repo: repoName, affiliation: 'direct', per_page: 100 }
    );

    const memberRows = collaborators
      .filter((c) => c.login !== ownerUsername)
      .map((c) => ({
        team_id:         team.id,
        github_username: c.login,
        role:            'member',
        // user_id is null until the collaborator signs into CodeLens
      }));

    if (memberRows.length > 0) {
      const { error: membersErr } = await supabaseAdmin
        .from('team_members')
        .insert(memberRows, { onConflict: 'team_id,github_username', ignoreDuplicates: true });

      if (membersErr) {
        console.error('[createTeam] insert members:', membersErr);
      } else {
        collaboratorCount = memberRows.length;
      }
    }
  } catch (ghErr) {
    console.error('[createTeam] GitHub collaborators fetch failed:', ghErr.message);
    // Non-fatal — team and owner are already created
  }

  // 4. Link the repo to the team
  await supabaseAdmin
    .from('team_repositories')
    .insert({ team_id: team.id, repo_id: repo.id });

  res.json({ ok: true, team, collaboratorCount });
};

/**
 * GET /api/teams — list teams the current user belongs to
 */
const listTeams = async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('team_members')
    .select('role, teams(id, name, created_at, created_by)')
    .eq('user_id', req.user.id)
    .order('joined_at', { ascending: false });

  if (error) {
    console.error('[listTeams]', error);
    return res.status(500).json({ error: 'Failed to fetch teams' });
  }

  const teams = (data || []).map((row) => ({
    ...row.teams,
    role: row.role,
  }));

  res.json({ teams });
};

/**
 * POST /api/teams/:teamId/repos — add a repo to a team (owner only)
 * Body: { repoId: string }
 */
const addRepoToTeam = async (req, res) => {
  const { teamId } = req.params;
  const { repoId } = req.body;

  if (!repoId) return res.status(400).json({ error: 'repoId is required' });

  // Check caller is owner of the team
  const { data: membership } = await supabaseAdmin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', req.user.id)
    .single();

  if (!membership || membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only team owners can add repositories' });
  }

  // Check caller owns the repo
  const { data: repo } = await supabaseAdmin
    .from('repositories')
    .select('id')
    .eq('id', repoId)
    .eq('user_id', req.user.id)
    .single();

  if (!repo) {
    return res.status(404).json({ error: 'Repository not found or you do not own it' });
  }

  const { error } = await supabaseAdmin
    .from('team_repositories')
    .insert({ team_id: teamId, repo_id: repoId });

  if (error && error.code !== '23505') { // ignore unique violation
    console.error('[addRepoToTeam]', error);
    return res.status(500).json({ error: 'Failed to add repository to team' });
  }

  res.json({ ok: true });
};

/**
 * GET /api/teams/:teamId/repos — list repos in a team
 */
const listTeamRepos = async (req, res) => {
  const { teamId } = req.params;

  // Verify membership
  const { data: membership } = await supabaseAdmin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', req.user.id)
    .single();

  if (!membership) {
    return res.status(403).json({ error: 'You are not a member of this team' });
  }

  const { data, error } = await supabaseAdmin
    .from('team_repositories')
    .select('repositories(*)')
    .eq('team_id', teamId);

  if (error) {
    console.error('[listTeamRepos]', error);
    return res.status(500).json({ error: 'Failed to fetch team repositories' });
  }

  const repos = (data || []).map((row) => ({ ...row.repositories, shared: true }));
  res.json({ repos });
};

module.exports = { createTeam, listTeams, addRepoToTeam, listTeamRepos };
