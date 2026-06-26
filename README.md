# CodeLens

**CodeLens** is a codebase intelligence platform that helps developers understand large and unfamiliar repositories quickly. Instead of manually tracing through hundreds of files, CodeLens indexes a repository, maps its structure, and lets developers ask natural language questions, visualize dependencies, and simulate the blast radius of a change — before making it.

---

## Features

### Interactive Dependency Graph
Analyzes the repository and builds a visual, force-directed dependency graph. Nodes represent files, edges show how they relate, with clustering, attack-surface overlays, and change impact analysis for blast radius review.

### Architectural Issue Detection
Automatically detects structural problems: circular dependencies, god files, high coupling, dead code, suppressions, and security signals. Issues are highlighted on the graph and grouped in a dedicated Issues panel.

### File Metrics & Complexity Analysis
Each file's lines of code, import/dependent count, and complexity score are surfaced in a sortable Metrics table. Critical and at-risk files are colour-coded for instant triage.

### Change Impact Analysis (Blast Radius)
Select any file to see exactly which other files would be affected by a change — direct and transitive dependents highlighted live on the graph and exportable as JSON.

### Dependencies & SCA
Scans package manifests and vulnerable packages so dependency risk is visible alongside code risk. Dependency findings can be reviewed from the Dependencies tab.

### Tours
Create, fork, and share guided tours that walk teammates through important files, graph paths, and repository concepts.

### Pull Requests
Pull request review integration is represented in the app and will expand into deeper PR review workflows in a future update.

### Agent / Search
Ask repository questions grounded in indexed code, graph data, issues, and metrics. Search and agent answers include source context so results can be verified.

### AI Code Review
Paste a code snippet or describe a change and get a structured review — bug detection, security flags, and improvement suggestions — powered by OpenAI.

### Settings
Manage webhook auto-sync, team membership, notification preferences, and CI integration for each repository.

### Team Organizations
Create a Team backed by your GitHub repository's collaborator list. Collaborators automatically see the shared indexed repository on their dashboard the first time they sign into CodeLens — no duplicate indexing.

### In-App Onboarding Guide
A persistent help icon opens a markdown-sourced guide that is fuzzy-searchable, deep-linkable, and organized around the main app tabs.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, D3.js v7, React Router 6 |
| Backend | Node.js 20, Express 4 |
| Database | PostgreSQL 15 (Supabase) + pgvector ≥ 0.5.0 |
| Auth | Supabase Auth, GitHub OAuth |
| Credential Security | Supabase Vault (pgsodium) — GitHub tokens stored encrypted |
| AST Parsing | Tree-sitter (JS, TS, JSX, TSX, Python, C#, Go, Java, Rust, Ruby) |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim) |
| Vector Index | pgvector HNSW (m=16, ef_construction=64) |
| LLM (RAG, review, audit, proposals, agent, tours) | OpenAI (`openai` SDK) — `gpt-4.1` / `gpt-4o-mini` |
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
OPENAI_API_KEY        # embeddings + all chat/reasoning (RAG, review, audit, proposals, agent, file chat, tours)
```

### 3. Apply database migrations

In your Supabase dashboard → **SQL Editor**, run the following scripts **in order**:

1. `scripts/schema.sql` — full schema: tables, RLS, HNSW index, Vault functions, match_code_chunks RPC
2. `scripts/us039_migration.sql` — one-time: backfills any existing plaintext GitHub tokens into Vault

Also enable the **`vector`** and **`supabase_vault`** extensions under Database → Extensions.

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

## Complexity Metric

`graph_nodes.complexity_score` reflects **true cyclomatic complexity** computed from each file's Tree-sitter AST (US-040). It equals the sum of logical decision points (`if`, `else if`, `for`, `while`, `catch`, `&&`, `||`, `?:`, and language-equivalent nodes) across all functions, plus the function count. Files with no functions score at least 1.

This value drives risk highlighting in the Metrics table (90th-percentile colouring) and the god-file issue detector (threshold: score > 30).

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
