# CodeLens — Production Deployment Guide

This guide covers everything needed to deploy CodeLens publicly with HTTPS.

---

## Architecture overview

| Layer     | Recommended service           | Alternative           |
|-----------|-------------------------------|-----------------------|
| Frontend  | **Vercel** (static + CDN)     | Netlify               |
| Backend   | **Render** (web service)      | Railway, Fly.io       |
| Database  | **Supabase** (new prod project) | —                   |
| Registry  | **GitHub Container Registry** (GHCR) | Docker Hub    |

---

## Prerequisites

- Docker installed locally (for testing production builds)
- GitHub repository with CI/CD workflows from US-030
- A domain name (optional but recommended)

---

## Step 1 — Production Supabase project

1. Go to [supabase.com](https://supabase.com) → New project
2. Once created, open the SQL Editor and run the schema:
   - `scripts/schema.sql`
3. Navigate to **Authentication → Providers → GitHub** and enable GitHub OAuth
4. Copy the following values (Settings → API):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

---

## Step 2 — GitHub OAuth App

Create a **new** OAuth App (or update the existing dev one) at
<https://github.com/settings/developers>:

| Field              | Value                                      |
|--------------------|--------------------------------------------|
| Homepage URL       | `https://your-frontend-domain.com`         |
| Callback URL       | `https://your-frontend-domain.com/auth/callback` |

Copy `Client ID` and `Client Secret`.

Also update the Supabase Auth settings:
- **Site URL**: `https://your-frontend-domain.com`
- **Redirect URLs**: add `https://your-frontend-domain.com/auth/callback`

---

## Step 3 — Deploy the backend (Render)

1. New **Web Service** → connect the GitHub repo
2. **Runtime**: Docker  
   **Dockerfile path**: `backend/Dockerfile`  
   **Root directory**: (leave blank — the context is the repo root)
3. Set the following **Environment Variables** as secrets:

```
NODE_ENV=production
PORT=3001
SUPABASE_URL=<from step 1>
SUPABASE_ANON_KEY=<from step 1>
SUPABASE_SERVICE_ROLE_KEY=<from step 1>
GITHUB_CLIENT_ID=<from step 2>
GITHUB_CLIENT_SECRET=<from step 2>
GITHUB_CALLBACK_URL=https://your-frontend-domain.com/auth/callback
OPENAI_API_KEY=<your key>
GROQ_API_KEY=<your key>
FRONTEND_URL=https://your-frontend-domain.com
BACKEND_URL=https://your-backend-domain.onrender.com
```

4. Deploy and copy the public HTTPS URL (e.g. `https://codelens-api.onrender.com`)

---

## Step 4 — Deploy the frontend (Vercel)

1. Import the GitHub repo into Vercel
2. **Framework preset**: Vite
3. **Root directory**: `frontend`
4. **Build command**: `npm run build`
5. **Output directory**: `dist`
6. Set the following **Environment Variables**:

```
VITE_SUPABASE_URL=<from step 1>
VITE_SUPABASE_ANON_KEY=<from step 1>
VITE_API_URL=https://codelens-api.onrender.com
VITE_API_PROXY_TARGET=https://codelens-api.onrender.com
```

7. Deploy and copy the production URL (e.g. `https://codelens.vercel.app`)
8. Go back and update `FRONTEND_URL` on the backend to match this URL

---

## Step 5 — Custom domain (optional)

- In Vercel: Settings → Domains → Add your domain → follow DNS instructions
- In Render: Settings → Custom Domains → follow DNS instructions

---

## Step 6 — GitHub Actions secrets (for CD pipeline)

In your GitHub repo → Settings → Secrets and variables → Actions, add:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_URL
```

The `GITHUB_TOKEN` secret is automatically provided by Actions.

---

## Step 7 — Branch protection

In GitHub → repo → Settings → Branches → Add rule for `main`:

- [x] Require a pull request before merging
- [x] Require status checks to pass before merging → select `Lint & Test`
- [x] Require branches to be up to date before merging

---

## Step 8 — CORS verification

The backend restricts `Access-Control-Allow-Origin` to the exact `FRONTEND_URL`
environment variable. After deployment, verify:

```bash
curl -si -X OPTIONS https://your-backend.onrender.com/api/repos \
  -H "Origin: https://malicious.com" \
  -H "Access-Control-Request-Method: GET"
# Expect: no Access-Control-Allow-Origin header for foreign origins
```

---

## Docker-only deployment (self-hosted)

If you prefer to self-host using the production compose file:

```bash
cp .env.example .env.prod
# Fill in all production values in .env.prod
docker-compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

The frontend container proxies `/api/*` to the backend via the Nginx config.
Set `VITE_API_URL` to an empty string or `/api` when using this setup.

---

## Health check

```
GET /health → { "status": "ok" }
```
