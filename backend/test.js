require('dotenv').config({ path: '../.env' });
const { supabaseAdmin } = require('./src/db/supabase');

async function run() {
  const { data: repo } = await supabaseAdmin.from('repositories').select('id').limit(1).single();
  if (!repo) return console.log('No repo found');
  
  console.time('clear_repo_derived_data');
  const { error } = await supabaseAdmin.rpc('clear_repo_derived_data', { p_repo_id: repo.id });
  console.timeEnd('clear_repo_derived_data');
  if (error) console.error(error);
}
run();
