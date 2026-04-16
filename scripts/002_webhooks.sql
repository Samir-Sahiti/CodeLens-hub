-- Migration: add webhook support columns to repositories
-- Apply via Supabase SQL Editor

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS webhook_secret    TEXT,
  ADD COLUMN IF NOT EXISTS auto_sync_enabled BOOLEAN NOT NULL DEFAULT false;
