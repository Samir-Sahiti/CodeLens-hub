-- US-067: AI Repo Agent — conversation persistence schema
--
-- Idempotent — safe to re-run. Apply this in addition to scripts/schema.sql
-- (the same blocks are appended there so schema.sql stays a single source of truth).
--
-- Persists agent_conversations + agent_messages. content_json is polymorphic by role:
--   role = 'user' | 'assistant'  → { text: string }
--   role = 'tool_use'            → { tool_name: string, input: object, tool_use_id: string }
--   role = 'tool_result'         → { tool_use_id: string, output: any, is_error: boolean }
-- tool_use_id matches the Anthropic protocol id so the trace can be replayed verbatim.

-- ─── agent message role enum ─────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE agent_message_role AS ENUM ('user', 'assistant', 'tool_use', 'tool_result');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── agent_conversations table ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_conversations (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id       UUID        NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  title         TEXT,
  total_tokens  INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_conversations_user_repo_updated_idx
  ON agent_conversations (user_id, repo_id, updated_at DESC);

ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access their own conversations" ON agent_conversations;
CREATE POLICY "Users access their own conversations"
  ON agent_conversations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Re-uses the set_updated_at() trigger function defined in schema.sql (US-054).
DROP TRIGGER IF EXISTS agent_conversations_set_updated_at ON agent_conversations;
CREATE TRIGGER agent_conversations_set_updated_at
  BEFORE UPDATE ON agent_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── agent_messages table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_messages (
  id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID                NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role            agent_message_role  NOT NULL,
  content_json    JSONB               NOT NULL,
  token_usage     JSONB,
  created_at      TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_messages_conv_created_idx
  ON agent_messages (conversation_id, created_at);

ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access messages of their conversations" ON agent_messages;
CREATE POLICY "Users access messages of their conversations"
  ON agent_messages FOR ALL
  USING (EXISTS (SELECT 1 FROM agent_conversations c
                  WHERE c.id = agent_messages.conversation_id
                    AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM agent_conversations c
                       WHERE c.id = agent_messages.conversation_id
                         AND c.user_id = auth.uid()));
