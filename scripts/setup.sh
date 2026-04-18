#!/usr/bin/env bash
# =============================================================================
# scripts/setup.sh — CodeLens local dev bootstrap
# Idempotent: safe to run more than once.
# =============================================================================
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> [1/4] Copying .env.example → .env (skipped if .env already exists)"
cp -n "$REPO_ROOT/.env.example" "$REPO_ROOT/.env" || true

echo "==> [2/4] Installing backend dependencies"
cd "$REPO_ROOT/backend" && npm install

echo "==> [3/4] Installing frontend dependencies"
cd "$REPO_ROOT/frontend" && npm install

echo ""
echo "✅  Setup complete."
echo ""
echo "Next steps:"
echo "  1. Fill in your credentials in .env"
echo "     - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
echo "     - GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET"
echo "     - ANTHROPIC_API_KEY, OPENAI_API_KEY"
echo "     - VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (same values as above)"
echo "  2. Run the migration: paste scripts/schema.sql into Supabase SQL Editor"
echo "  3. Start Postgres:  docker-compose up -d"
echo "  4. Start backend:   cd backend && npm run dev"
echo "  5. Start frontend:  cd frontend && npm run dev"
