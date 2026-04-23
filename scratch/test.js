const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf-8');
const supabaseUrl = env.match(/SUPABASE_URL=(.+)/)[1];
const supabaseKey = env.match(/SUPABASE_SERVICE_KEY=(.+)/)[1];

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: repo } = await supabaseAdmin.from('repositories').select('id').limit(1).single();
  if (!repo) return console.log('No repo found');
  
  console.time('clear_repo_derived_data');
  const { error } = await supabaseAdmin.rpc('clear_repo_derived_data', { p_repo_id: repo.id });
  console.timeEnd('clear_repo_derived_data');
  if (error) console.error(error);
}
run();
