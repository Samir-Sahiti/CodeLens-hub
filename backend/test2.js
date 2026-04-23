require('dotenv').config({ path: '../.env' });
const indexer = require('./src/services/indexer');
const { supabaseAdmin } = require('./src/db/supabase');

async function run() {
  const { data: repo } = await supabaseAdmin.from('repositories').select('*').limit(1).single();
  if (!repo) return console.log('No repo found');
  
  const { data: profile } = await supabaseAdmin.from('profiles').select('github_token_secret_id').eq('id', repo.user_id).single();
  const { data: tokenData } = await supabaseAdmin.rpc('get_github_token_secret', { secret_id: profile.github_token_secret_id });
  
  console.log('Starting index for', repo.full_name);
  await indexer.startGitHubIndexing(repo.id, tokenData, repo.full_name || repo.name);
  console.log('Done indexing script');
}
run();
