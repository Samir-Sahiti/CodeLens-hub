# CLAUDE.md — CodeLens Hub

## What This Project Is

CodeLens is a full-stack web app that helps developers understand large, unfamiliar codebases. Core capabilities:
- Interactive force-directed dependency graph (D3.js)
- Architectural issue detection (circular deps, god files, dead code, high coupling)
- RAG-powered natural language code search
- File complexity/impact ("blast radius") analysis
- AI code review panel

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, D3.js v7, React Router 6 |
| Backend | Node.js 20, Express 4 |
| Database | PostgreSQL 15 (Supabase) + pgvector extension |
| Auth | Supabase Auth, GitHub OAuth |
| AST Parsing | Tree-sitter (JS, TS, TSX, Python, C#, Go, Java, Rust, Ruby) |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim) |
| LLM/RAG | Groq API |
| GitHub integration | Octokit |
| AI SDK | `@anthropic-ai/sdk` |

---

## Running the App

```bash
# Bootstrap (first time)
bash scripts/setup.sh
# Fill in .env (copy from .env.example), apply SQL schema via Supabase dashboard

# Development (two terminals)
cd backend && npm run dev   # http://localhost:3001
cd frontend && npm run dev  # http://localhost:3000

# Or via Docker
docker-compose up -d
```

Frontend dev server proxies `/api/*` to `localhost:3001`.

---

## Key Scripts

```bash
# Frontend
npm run dev      # Vite dev server
npm run build    # Production build → dist/
npm run lint     # ESLint

# Backend
npm run dev      # Nodemon watch
npm start        # Production
npm run lint     # ESLint
```

---

## Project Structure

```
CodeLens-hub/
├── frontend/src/
│   ├── components/     # UI: DependencyGraph, SearchPanel, ReviewPanel, etc.
│   ├── pages/          # Login, Dashboard, RepoView, Search
│   ├── context/        # AuthContext
│   ├── hooks/          # useGraphSimulation (D3 physics)
│   └── lib/            # supabase.js client
│
├── backend/src/
│   ├── index.js        # Express setup + all route mounting
│   ├── routes/         # Route definitions
│   ├── controllers/    # Request handlers (repo, search, analysis, review)
│   ├── services/       # Business logic (indexer, indexerService)
│   ├── parsers/        # Tree-sitter AST parsing per language
│   ├── ai/             # ragService.js (RAG pipeline)
│   ├── db/             # Supabase admin client
│   └── middleware/     # Auth, error handling
│
├── scripts/
│   ├── setup.sh                 # Idempotent bootstrap
│   └── schema.sql               # Full DB schema (tables, RLS, indexes)
│
└── docker-compose.yml           # postgres + backend + frontend
```

---

## API Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `*` | `/api/auth/*` | GitHub OAuth |
| `*` | `/api/repos/*` | Connect repos, upload ZIPs |
| `*` | `/api/search/*` | RAG code search |
| `*` | `/api/analysis/*` | Dependency graph, metrics, issues, impact |
| `*` | `/api/review/*` | AI code review |

---

## Database Schema

Tables (all with RLS):
- `profiles` — user metadata + `github_token_secret_id` (UUID referencing Supabase Vault; tokens are never stored plaintext — migrated in US-039)
- `repositories` — connected repos, status: `pending | indexing | ready | failed`
- `graph_nodes` — files with metrics (line_count, **complexity_score** is true cyclomatic complexity via Tree-sitter AST, incoming/outgoing counts)
- `graph_edges` — dependency edges (from_path → to_path)
- `code_chunks` — chunked source code with 1536-dim pgvector embeddings (HNSW index, m=16, ef_construction=64)
- `analysis_issues` — detected issues: `circular_dependency | god_file | dead_code | high_coupling`

---

## Environment Variables

Required in `.env` (see `.env.example`):

```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL, VITE_API_PROXY_TARGET
GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_CALLBACK_URL
OPENAI_API_KEY       # for text-embedding-3-small
GROQ_API_KEY         # for RAG LLM responses
NODE_ENV, PORT
```

---

## Indexing Pipeline (Core Flow)

1. User connects GitHub repo → Octokit fetches repo tree
2. Files filtered by supported language (`.js`, `.ts`, `.tsx`, `.py`, `.cs`, `.go`, `.java`, `.rs`, `.rb`)
3. Tree-sitter parses each file → extracts imports, exports, and computes **cyclomatic complexity** (US-040)
4. Dependency graph built → stored in `graph_nodes` + `graph_edges`
5. Source split into semantic chunks → embeddings via OpenAI → stored in `code_chunks`
6. Analysis runs → issues stored in `analysis_issues`

---

## Complexity Score (US-040)

`graph_nodes.complexity_score` holds the **true cyclomatic complexity** of each file, computed from the Tree-sitter AST by `backend/src/parsers/complexity.js`.

**Formula:** `complexity = Σ(decision_points_per_function) + max(1, function_count)`

Decision points counted per language:
- **JS/TS/JSX/TSX:** `if_statement`, `else_clause`, `for_statement`, `while_statement`, `do_statement`, `switch_case`, `ternary_expression`, `catch_clause`, `binary_expression` where operator is `&&` or `||`
- **Python:** `if_statement`, `elif_clause`, `for_statement`, `while_statement`, `except_clause`, `boolean_operator`, `conditional_expression`
- **C#:** `if_statement`, `else_clause`, `for_statement`, `while_statement`, `do_statement`, `switch_section`, `conditional_expression`, `catch_clause`, `conditional_access_expression`
- **Go:** `if_statement`, `for_statement`, `expression_case`, `type_case`, `communication_case`
- **Java:** `if_statement`, `else_clause`, `for_statement`, `while_statement`, `do_statement`, `switch_label`, `ternary_expression`, `catch_clause`
- **Rust:** `if_expression`, `else_clause`, `for_expression`, `while_expression`, `loop_expression`, `match_arm`
- **Ruby:** `if`, `elsif`, `unless`, `case_match`, `when`, `rescue`, `for`, `while`, `until`

**Issue thresholds (re-tuned for actual cyclomatic scores):**
- God file: `complexity_score > 30` OR `(line_count > 500 AND incoming_count > 10% of total nodes)` OR `incoming_count > 30% of total nodes`
- High coupling: `outgoing_count > 15` (medium ≥ 20, high ≥ 30)

---

## Security: GitHub Token Vault (US-039)

GitHub access tokens are stored encrypted in **Supabase Vault** — never in plaintext columns.

- `profiles.github_token_secret_id` (UUID) — references the Vault entry
- Tokens are written via the `create_github_token_secret(token)` SQL function
- Tokens are read via `get_github_token_secret(secret_id)` — **only callable by `service_role`**
- `console.log`/`error`/`warn` are globally intercepted in `backend/src/index.js` to redact any `ghp_`/`gho_`/`ghu_`-prefixed strings from logs
- One-time migration: `scripts/us039_migration.sql` backfills plaintext tokens and drops the old column

---

## Vector Search Index (US-041)

`code_chunks.embedding` uses an **HNSW** index (pgvector ≥ 0.5.0 required):
```sql
CREATE INDEX ON code_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```
- The `match_code_chunks(p_repo_id, p_embedding, p_top_k)` RPC sets `SET LOCAL hnsw.ef_search = 100` per request for higher recall
- Benchmark: `node backend/scripts/benchmark-vector-search.js` (set `REPO_ID=<uuid>` env var)

---

## Testing

No automated test suite currently exists. Manual test utilities are in:
- `backend/src/parsers/test-parser.js`
- `backend/src/parsers/debug-ast.js`

When adding tests, prefer Vitest for frontend, Jest or Vitest for backend.

---

## Linting

ESLint is configured in both `frontend/` and `backend/`. No Prettier, no commit hooks. Run `npm run lint` inside each subdirectory.

---

## Architectural Conventions

- **Backend:** MVC-ish pattern — routes → controllers → services → parsers/AI/db
- **Frontend:** Feature-based component structure, single AuthContext for session
- **Auth:** All backend routes requiring auth validate the Supabase JWT via middleware
- **Error handling:** `express-async-errors` patches async routes; centralized error middleware in `backend/src/middleware/`
- **Concurrency:** `p-limit` controls concurrent repo file fetches to avoid GitHub rate limits

---

## Notes for Development

- Tree-sitter native modules require build tools (python3, make, g++) — the `backend/Dockerfile.dev` handles this; local installs need them too
- The Supabase schema must be applied manually via the Supabase SQL Editor before the app works
- Frontend Vite proxy (`/api/*` → port 3001) is configured in `frontend/vite.config.js`
- No CI/CD pipeline is currently configured
