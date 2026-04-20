-- =============================================================================
-- Migration: Move GitHub access tokens to Supabase Vault (US-039)
-- Run this in the Supabase SQL Editor.
-- =============================================================================

-- 1. Enable Vault extension
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;

-- 2. Add the new UUID references to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS github_token_secret_id UUID;

-- 3. Create wrapper RPCs in public so the backend can securely interact with Vault
-- Each secret gets a unique name so vault's name uniqueness constraint is satisfied.
CREATE OR REPLACE FUNCTION create_github_token_secret(token text)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT vault.create_secret(token, 'github_token_' || gen_random_uuid());
$$;

CREATE OR REPLACE FUNCTION get_github_token_secret(secret_id uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id = secret_id;
$$;

-- IMPORTANT: Only the service_role should be able to read decrypted tokens.
REVOKE EXECUTE ON FUNCTION get_github_token_secret FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_github_token_secret TO service_role;

-- 4. Idempotent one-time backfill
DO $$ 
DECLARE
  profile_row RECORD;
  new_secret_id UUID;
BEGIN
  FOR profile_row IN 
    SELECT id, github_access_token 
    FROM profiles 
    WHERE github_token_secret_id IS NULL AND github_access_token IS NOT NULL
  LOOP
    -- Insert into vault with a per-user unique name
    SELECT vault.create_secret(profile_row.github_access_token, 'github_token_' || profile_row.id) INTO new_secret_id;
    
    -- Update profile
    UPDATE profiles 
    SET github_token_secret_id = new_secret_id,
        github_access_token = NULL
    WHERE id = profile_row.id;
  END LOOP;
END $$;

-- 5. Drop the old plaintext column
ALTER TABLE profiles DROP COLUMN IF EXISTS github_access_token;
