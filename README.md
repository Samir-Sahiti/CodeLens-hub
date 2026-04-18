# CodeLens

**CodeLens** is a codebase intelligence platform that helps developers understand large and unfamiliar repositories quickly. Instead of manually tracing through hundreds of files, CodeLens indexes a repository, maps its structure, and lets developers ask natural language questions, visualize dependencies, and simulate the blast radius of a change — before making it.

---

## Features

### Interactive Dependency Graph
Analyzes the repository and builds a visual, force-directed dependency graph. Nodes represent files, edges show how they relate. Supports both SVG rendering (small repos) and Canvas rendering (large repos with 300+ files), with clustering for very large graphs. Export the current graph view as PNG or SVG.

### Architectural Issue Detection
Automatically detects structural problems: circular dependencies, god files, high coupling, and dead code. Issues are highlighted on the graph and grouped in a dedicated Issues panel.

### File Metrics & Complexity Analysis
Each file's lines of code, import/dependent count, and complexity score are surfaced in a sortable Metrics table. Critical and at-risk files are colour-coded for instant triage.

### Change Impact Analysis (Blast Radius)
Select any file to see exactly which other files would be affected by a change — direct and transitive dependents highlighted live on the graph and exportable as JSON.

### Natural Language Code Search
RAG-powered search over the indexed codebase. Queries like "How does authentication work?" return context-aware, streamed answers with source references. Powered by OpenAI embeddings and Groq LLM.

### AI Code Review
Paste a code snippet or describe a change and get a structured review — bug detection, security flags, and improvement suggestions — powered by Anthropic Claude.

### GitHub Webhook Auto-sync
Connect a GitHub webhook so the dependency graph and AI search index automatically re-index on every push to the default branch — no manual re-indexing required.

### Team Organizations
Create a Team backed by your GitHub repository's collaborator list. Collaborators automatically see the shared indexed repository on their dashboard the first time they sign into CodeLens — no duplicate indexing.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, D3.js v7, React Router 6 |
| Backend | Node.js 20, Express 4 |
| Database | PostgreSQL 15 (Supabase) + pgvector |
| Auth | Supabase Auth, GitHub OAuth |
| AST Parsing | Tree-sitter (JS, TS, TSX, Python, C#) |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim) |
| LLM / RAG | Groq API |
| AI Code Review | Anthropic Claude (`@anthropic-ai/sdk`) |
| GitHub Integration | Octokit |
| Containerisation | Docker, Docker Compose |
| CI/CD | GitHub Actions → GitHub Container Registry |

---

## Project Structure

```
CodeLens-hub/
├── frontend/src/
│   ├── components/     # DependencyGraph, SearchPanel, CodeReviewPanel,
│   │                   # CreateTeamModal, Layout, etc.
│   ├── pages/          # Login, Dashboard, RepoView
│   ├── context/        # AuthContext, RepoContext
│   ├── hooks/          # useGraphSimulation (D3 physics)
│   └── lib/            # supabase.js client
│
├── backend/src/
│   ├── index.js        # Express setup + route mounting
│   ├── routes/         # repo, auth, search, analysis, review, webhooks, teams
│   ├── controllers/    # repoController, webhookController, teamController, …
│   ├── services/       # indexer.js, indexerService.js
│   ├── parsers/        # Tree-sitter AST parsers per language
│   ├── ai/             # ragService.js
│   ├── db/             # Supabase admin client
│   └── middleware/     # requireAuth, errorHandler
│
├── scripts/
│   ├── setup.sh                 # Idempotent bootstrap
│   └── schema.sql               # Full DB schema — tables, RLS policies, indexes
│
├── .github/workflows/
│   ├── ci.yml                   # Lint + test on push / PR
│   └── cd.yml                   # Build & push Docker images to GHCR on main
│
├── docker-compose.yml           # Local development (hot-reload)
├── docker-compose.prod.yml      # Production (no mounts, non-root containers)
├── DEPLOYMENT.md                # Step-by-step production hosting guide
└── README.md
```

---

## Getting Started (Local)

### Prerequisites

- **Node.js 20+**
- **Docker Desktop** — for local Postgres (or use an existing Supabase project)
- **Supabase project** — [supabase.com](https://supabase.com)
- **GitHub OAuth App** — GitHub → Settings → Developer settings → OAuth Apps

### 1. Clone and bootstrap

```bash
git clone https://github.com/Samir-Sahiti/CodeLens-hub.git
cd CodeLens-hub

# Installs deps and copies .env.example → .env
bash scripts/setup.sh
```

### 2. Configure environment

Fill in `.env` with your credentials:

```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_CALLBACK_URL
OPENAI_API_KEY        # embeddings
GROQ_API_KEY          # RAG LLM responses
```

### 3. Apply database migrations

In your Supabase dashboard → **SQL Editor**, run:

1. `scripts/schema.sql`

Also enable the **`vector`** extension under Database → Extensions.

### 4. Run the app

```bash
# Terminal 1 — Express API (localhost:3001)
cd backend && npm run dev

# Terminal 2 — Vite dev server (localhost:3000)
cd frontend && npm run dev
```

The frontend proxies all `/api/*` requests to the backend — no CORS config needed in development.

### Or with Docker

```bash
docker-compose up -d
```

---

## Production Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for a full step-by-step guide covering:
- Supabase production project setup
- GitHub OAuth App configuration
- Backend on Render, frontend on Vercel
- CI/CD via GitHub Actions → GHCR
- CORS verification and branch protection

---

## API Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `*` | `/api/auth/*` | GitHub OAuth + profile sync |
| `*` | `/api/repos/*` | Connect repos, upload ZIPs, re-index, webhook config |
| `*` | `/api/search/*` | RAG code search (SSE streaming) |
| `*` | `/api/analysis/*` | Dependency graph, metrics, issues, impact |
| `*` | `/api/review/*` | AI code review |
| `POST` | `/api/webhooks/github` | GitHub push event receiver |
| `*` | `/api/teams/*` | Team CRUD + collaborator sync |

---

## Team

- Leutrim Istrefi
- Rinor Abazi
- Samir Sahiti
