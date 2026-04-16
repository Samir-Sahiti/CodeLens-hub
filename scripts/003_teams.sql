-- Migration: Teams / Organizations
-- Apply via Supabase SQL Editor after 002_webhooks.sql

-- ── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  created_by UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  github_username TEXT        NOT NULL,
  role            TEXT        NOT NULL DEFAULT 'member'
                              CHECK (role IN ('owner', 'member')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, github_username)
);

CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON team_members (user_id);
CREATE INDEX IF NOT EXISTS team_members_team_id_idx ON team_members (team_id);

CREATE TABLE IF NOT EXISTS team_repositories (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  UNIQUE (team_id, repo_id)
);

CREATE INDEX IF NOT EXISTS team_repositories_team_id_idx ON team_repositories (team_id);
CREATE INDEX IF NOT EXISTS team_repositories_repo_id_idx ON team_repositories (repo_id);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_repositories ENABLE ROW LEVEL SECURITY;

-- Teams: visible to members of the team
CREATE POLICY "Team members can view their teams"
  ON teams FOR SELECT
  USING (
    id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Owners can insert/delete teams they created
CREATE POLICY "Team owners can manage their teams"
  ON teams FOR ALL
  USING (created_by = auth.uid());

-- team_members: visible to other members of the same team
CREATE POLICY "Team members can view members of their teams"
  ON team_members FOR SELECT
  USING (
    team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- team_repositories: visible to team members
CREATE POLICY "Team members can view team repositories"
  ON team_repositories FOR SELECT
  USING (
    team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- ── Update repositories RLS for team access ───────────────────────────────────
-- Drop the original single-owner policy and replace with one that also
-- grants read access to team members.

DROP POLICY IF EXISTS "Users can only access their own repos" ON repositories;

CREATE POLICY "Users can access own repos or team-shared repos"
  ON repositories FOR ALL
  USING (
    auth.uid() = user_id
    OR id IN (
      SELECT repo_id
      FROM   team_repositories
      WHERE  team_id IN (
        SELECT team_id FROM team_members WHERE user_id = auth.uid()
      )
    )
  );
