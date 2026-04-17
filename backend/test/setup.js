// Stub Supabase env vars so the db/supabase.js module can load during tests.
// Integration tests replace the actual clients via globalThis injection.
process.env.SUPABASE_URL              = process.env.SUPABASE_URL              || 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY         = process.env.SUPABASE_ANON_KEY         || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.OPENAI_API_KEY            = process.env.OPENAI_API_KEY            || 'test-openai-key';
process.env.GROQ_API_KEY              = process.env.GROQ_API_KEY              || 'test-groq-key';
