require('dotenv').config();
const { getGithubTokenForUser } = require('../src/lib/githubAuth');
const { Octokit } = require('octokit');

async function test() {
  const userId = '85e97fb8-59c4-406a-86a2-a9b01518fdf9'; // from user=85e97fb8 in the logs, but wait, I can just query the first user
  
  const { supabaseAdmin } = require('../src/db/supabase');
  const { data: user } = await supabaseAdmin.from('profiles').select('id').limit(1).single();
  
  if (!user) {
    console.error('No user found');
    return;
  }
  console.log('Testing with user', user.id);

  const githubToken = await getGithubTokenForUser(user.id);
  if (!githubToken) {
    console.error('No github token found');
    return;
  }
  console.log('Got github token', githubToken.substring(0, 5) + '...');

  const octokit = new Octokit({ auth: githubToken });
  try {
    const { data } = await octokit.rest.pulls.list({
      owner: 'Samir-Sahiti',
      repo: 'CodeLens-hub',
      state: 'open',
    });
    console.log('Success, pulls count:', data.length);
  } catch (err) {
    console.error('Error fetching pulls:', err.status, err.message);
  }
}

test().catch(console.error);
