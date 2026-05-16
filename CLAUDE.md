# CLAUDE.md — CodeLens Hub

## What This Project Is

CodeLens is a full-stack web app that helps developers understand large, unfamiliar codebases. Core capabilities:
- Interactive force-directed dependency graph (D3.js) with clustering, impact analysis, and attack surface overlay
- Architectural issue detection (circular deps, god files, dead code, high coupling)
- Security scanning: secret detection, SAST pattern matching, dependency vulnerability scanning, attack surface mapping, auth coverage checking
- AI security audit mode with whole-repo auditing and structured findings
- RAG-powered natural language code search
- File complexity/impact ("blast radius") analysis

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
| LLM/Review | Anthropic Claude (`@anthropic-ai/sdk`) — `claude-sonnet-4-20250514` |
| GitHub integration | Octokit |

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
│   ├── components/         # UI components
│   │   ├── DependencyGraph.jsx       # D3 graph + attack surface overlay (US-047)
│   │   ├── CodeReviewPanel.jsx       # AI review + security audit mode (US-048)
│   │   ├── IssuesPanel.jsx           # All issue types including missing_auth (US-049)
│   │   ├── ImpactAnalysisPanel.jsx   # Blast-radius panel
│   │   ├── MetricsPanel.jsx
│   │   ├── SearchPanel.jsx
│   │   └── ui/                       # Primitives, Icons (lucide-react re-exports)
│   ├── pages/              # Login, Dashboard, RepoView, Search
│   ├── context/            # AuthContext
│   ├── hooks/
│   │   └── useGraphSimulation.js     # D3 physics + visual modes (selection/impact/attack surface)
│   └── lib/                # supabase.js client, api.js, constants.js
│
├── backend/src/
│   ├── index.js            # Express setup + all route mounting
│   ├── routes/             # Route definitions
│   ├── controllers/        # Request handlers
│   │   ├── analysisController.js     # Issues, suppress, impact
│   │   └── reviewController.js       # AI review + security audit (US-048)
│   ├── services/           # Business logic
│   │   ├── indexerService.js         # Core indexing pipeline
│   │   ├── secretScanner.js          # Hardcoded secret detection (US-044)
│   │   ├── sastEngine.js             # AST-based SAST rules (US-046)
│   │   ├── authCoverageScanner.js    # Auth coverage check (US-049)
│   │   ├── attackSurfaceClassifier.js # Source/sink classification (US-047)
│   │   ├── manifestParser.js         # Dependency manifest parsing (US-045)
│   │   ├── osvScanner.js             # OSV.dev vulnerability lookup (US-045)
│   │   └── usageTracker.js           # Daily token budget (US-042)
│   ├── sast/
│   │   ├── secret-rules.json         # Regex rules for secret scanning
│   │   └── rules/                    # Per-language SAST rules (US-046)
│   ├── parsers/            # Tree-sitter AST parsing per language
│   ├── ai/                 # ragService.js (RAG pipeline)
│   ├── db/                 # Supabase admin client
│   └── middleware/         # Auth, error handling, AI rate limiting
│
├── scripts/
│   ├── setup.sh                      # Idempotent bootstrap
│   ├── schema.sql                    # Full DB schema — apply via Supabase SQL Editor
│   └── us048_security_audits.sql     # security_audits table + RLS
│
└── docker-compose.yml      # postgres + backend + frontend
```

---

## API Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `*` | `/api/auth/*` | GitHub OAuth |
| `*` | `/api/repos/*` | Connect repos, upload ZIPs, patch config |
| `GET` | `/api/repos/:id/dependencies` | SCA vulnerability data (US-045) |
| `*` | `/api/search/*` | RAG code search |
| `*` | `/api/analysis/*` | Graph, metrics, issues, impact |
| `POST` | `/api/analysis/:id/issues/suppress` | Suppress an issue (secrets + missing_auth) |
| `POST` | `/api/review/:id` | Single-file AI review or security audit |
| `POST` | `/api/review/:id/security-audit` | Whole-repo security audit (US-048) |
| `GET` | `/api/review/:id/security-audits` | Audit history |
| `GET` | `/api/review/:id/security-audits/:auditId` | Single audit |

---

## Database Schema

Tables (all with RLS):
- `profiles` — user metadata + `github_token_secret_id` (UUID referencing Supabase Vault; tokens never stored plaintext — US-039)
- `repositories` — connected repos, status: `pending | indexing | ready | failed`; `sast_disabled_rules TEXT[]` for per-repo SAST rule opt-outs (US-046)
- `graph_nodes` — files with metrics: `line_count`, `complexity_score` (true cyclomatic via Tree-sitter), `incoming_count`, `outgoing_count`, `content_hash`, `node_classification` (`source | sink | both | null` — US-047)
- `graph_edges` — dependency edges (`from_path → to_path`)
- `code_chunks` — chunked source with 1536-dim pgvector embeddings (HNSW index m=16, ef_construction=64)
- `analysis_issues` — issue types: `circular_dependency | god_file | dead_code | high_coupling | hardcoded_secret | insecure_pattern | vulnerable_dependency | missing_auth`
- `issue_suppressions` — per-instance suppression: `{ repo_id, file_path, rule_id, line_number, created_by, created_at }` — used by secrets (US-044) and missing_auth (US-049)
- `vulnerability_cache` — OSV.dev results per `(ecosystem, name, version)` with 24 h TTL (US-045)
- `dependency_manifests` — per-package SCA results for the Dependencies tab; cleared on re-index (US-045)
- `security_audits` — whole-repo AI audit reports: `{ id, user_id, repo_id, findings_json, created_at }` (US-048)
- `api_usage` — per-user token usage tracking for daily budget enforcement (US-042)

**Schema migration:** `scripts/schema.sql` is idempotent and safe to re-run. Apply via Supabase SQL Editor. The `scripts/us048_security_audits.sql` file creates the `security_audits` table separately.

---

## Environment Variables

Required in `.env` (see `.env.example`):

```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL, VITE_API_PROXY_TARGET
GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_CALLBACK_URL
OPENAI_API_KEY        # for text-embedding-3-small
GROQ_API_KEY          # for RAG LLM responses
ANTHROPIC_API_KEY     # for AI code review + security audit (US-048)
NODE_ENV, PORT
MAX_DAILY_TOKENS_PER_USER   # optional, default 500000 (US-042)
```

---

## Indexing Pipeline (Core Flow)

Per-file scanning runs inside a `p-limit` concurrency pool. All scanners are wrapped in try/catch — failures are logged and never block the pipeline.

1. Repo tree fetched (GitHub Octokit or uploaded ZIP)
2. Files filtered by supported extension; manifest files separated
3. Incremental hash check — unchanged files reuse their DB state
4. Tree-sitter parses each changed file → imports, exports, cyclomatic complexity
5. Per-file scanners run in the same loop:
   - **Secret scanner** (`secretScanner.js`) — regex rules + high-entropy catch-all; suppressions filtered via `suppSet` (US-044)
   - **SAST engine** (`sastEngine.js`) — AST-query rules per language; per-repo disabled rules respected (US-046)
   - **Auth coverage scanner** (`authCoverageScanner.js`) — detects route handlers with no auth middleware; suppressions filtered (US-049)
6. **Attack surface classifier** (`attackSurfaceClassifier.js`) — classifies each file as `source | sink | both | null`; stored as `node_classification` on the graph node (US-047)
7. Dependency graph upserted (`graph_nodes` + `graph_edges`); metrics (incoming/outgoing counts) computed in-memory then persisted
8. Architectural issue detection: circular dependencies (DFS), god files, high coupling, dead code
9. SCA: manifest files parsed → OSV.dev batch query → `vulnerability_cache` + `dependency_manifests` + `analysis_issues` (US-045)
10. All collected issues bulk-inserted into `analysis_issues`
11. File contents stored in `file_contents` table for AI review retrieval (US-043)

---

## Complexity Score (US-040)

`graph_nodes.complexity_score` — true cyclomatic complexity from Tree-sitter AST via `backend/src/parsers/complexity.js`.

**Formula:** `complexity = Σ(decision_points_per_function) + max(1, function_count)`

**Issue thresholds:**
- God file: `complexity_score > 30` OR `(line_count > 500 AND incoming_count > 10% of nodes)` OR `incoming_count > 30% of nodes`
- High coupling: `outgoing_count > 15` (medium ≥ 20, high ≥ 30)

---

## Security: GitHub Token Vault (US-039)

GitHub tokens stored encrypted in Supabase Vault — never plaintext.
- Read via `get_github_token_secret(secret_id)` — service_role only
- `console.log/error/warn` globally intercepted in `backend/src/index.js` to redact `ghp_`/`gho_`/`ghu_` strings

---

## Secret Scanning (US-044)

`backend/src/services/secretScanner.js` — runs per-file during indexing.
- Rules loaded from `backend/src/sast/secret-rules.json` (JSON, add patterns without code changes)
- Detects: AWS keys, GitHub tokens, OpenAI/Anthropic keys, Stripe live keys, Google API keys, Slack tokens, JWTs, RSA/SSH private key blocks
- High-entropy catch-all: Shannon entropy > 4.5 over ≥ 20 chars assigned to `*_key / *_secret / *_token / *_password` variables
- Each issue: `type: 'hardcoded_secret'`, `severity: 'high'`, description contains line number + rule ID (never the secret value)
- Suppressions via `issue_suppressions` table; "Mark as false positive" in IssuesPanel

---

## SAST Pattern Scanning (US-046)

`backend/src/services/sastEngine.js` — AST-query rules per language.
- Rules in `backend/src/sast/rules/<language>.json`
- Targets: `eval()`, `dangerouslySetInnerHTML`, `child_process.exec` with template literals, `pickle.loads`, `subprocess(shell=True)`, weak crypto (MD5/SHA1/DES), SQL string concatenation, etc.
- Per-repo opt-out via `repositories.sast_disabled_rules TEXT[]`
- "Disable this rule" action in IssuesPanel persists to that column

---

## Attack Surface Mapping (US-047)

`backend/src/services/attackSurfaceClassifier.js` — pure regex, runs per-file during indexing.

**Source heuristics** (per language): HTTP route registration (Express/Flask/FastAPI/Spring/ASP.NET/actix-web/axum/Rails), CLI args (`process.argv`, `sys.argv`, `os.Args`), stdin reads.

**Sink heuristics** (cross-language): SQL execution, shell/process execution, filesystem writes, deserialisation (`pickle.loads`, `JSON.parse`, `yaml.load` without SafeLoader, Java `ObjectInputStream`), dynamic outbound HTTP.

**`graph_nodes.node_classification`**: `'source' | 'sink' | 'both' | null` — preserved across incremental re-indexes.

**Frontend (DependencyGraph.jsx + useGraphSimulation.js):**
- "Attack Surface" toggle button forces flat (non-clustered) graph rendering
- Sources → red nodes + red-300 stroke halo; sinks → orange; both → yellow; neutrals → 12% opacity
- Client-side DFS (`findAllPaths`, capped at 50 paths, depth 20) finds all source→sink paths
- Animated yellow edges highlight the selected source's paths
- `AttackSurfacePanel` — sources list with per-source path counts → drillable path view with "…N more" expand
- "Show reachable paths" in node context menu (source nodes only)
- Empty state if no sources or no sinks detected

---

## Auth Coverage Check (US-049)

`backend/src/services/authCoverageScanner.js` — two-layer heuristic, runs per-file during indexing.

**Layer 1 — In-file markers:** `passport.authenticate`, `requireAuth`, `requiresAuth`, `isAuthenticated`, `verifyToken`, `@login_required`, `@authorize`, `[Authorize]`, `@UseGuards`, Devise `authenticate_user!`, Sorcery `require_login`, and others.

**Layer 2 — Import paths:** Any import whose resolved path contains `auth`, `jwt`, `passport`, `guards/`, `middleware/auth`, `authGuard`, `canActivate`, etc.

**Public route allow-list:** `/health`, `/healthz`, `/ping`, `/status`, `/metrics`, `/favicon.ico`, `/login`, `/signup`, `/register`, `/auth/*`, `/oauth/*`, `/.well-known/*`, `/public/*`, `/static/*`, `/assets/*`.

- Emits `type: 'missing_auth'`, `severity: 'medium'` with the specific unprotected route paths in the description
- Suppressed via `issue_suppressions` with `rule_id: 'missing_auth'`, `line_number: 0` (file-level)
- "Mark as intentionally public" in IssuesPanel; suppressions persist across re-indexes
- IssuesPanel groups under "Potentially Unauthenticated Routes" with `AlertTriangle` icon

---

## AI Security Audit Mode (US-048)

`backend/src/controllers/reviewController.js` — extends the existing AI code review panel.

**Single-file audit** (`POST /api/review/:repoId`, `mode: 'security_audit'`):
- Retrieves 12 chunks, re-ranks by security keyword frequency (`auth`, `password`, `token`, `crypto`, `sanitize`, `exec`, `eval`, `sql`)
- Security-focused system prompt: injection, auth/authz flaws, crypto misuse, secrets, input validation, error leaks, dependency risks, logic flaws
- Returns structured findings: `{ severity, category, line_reference, explanation, suggested_fix, confidence }`
- Raw JSON chunks suppressed from SSE stream; only parsed `finding` events reach the client
- Cross-links findings to deterministic `analysis_issues` rows that affect the same file

**Whole-repo audit** (`POST /api/review/:repoId/security-audit`):
- Targets top 20 files by `incoming_count + complexity_score` (via `get_security_audit_targets()` RPC)
- Processes sequentially, checking daily token budget before each file
- Streams `progress` + `finding` + `summary` SSE events; report persisted to `security_audits` table
- Partial audits (budget exhausted) are saved with `status: 'partial'`

**Frontend (CodeReviewPanel.jsx):**
- Mode toggle: "General" | "Security Audit" (SegmentedControl)
- Security mode: "Audit Code" + "Run security audit" buttons; hides the focus presets row
- Focus presets (general mode only): Performance, Bug Hunt, Architecture — the Security preset was removed per US-048 spec
- `FindingCard` renders each structured finding with severity/category/confidence badges and deterministic agreement links
- Audit history panel shows last 5 audits with status and finding count
- Token budget enforced server-side; `aiRateLimit` middleware applies

---

## Dependency Vulnerability Scanning (US-045)

OSV.dev SCA during indexing. Supported manifests: `package.json`, `package-lock.json`, `yarn.lock`, `requirements.txt`, `Pipfile.lock`, `go.mod`, `Cargo.lock`, `Gemfile.lock`, `*.csproj`. Results cached 24 h. Best-effort — never blocks indexing.

---

## Vector Search Index (US-041)

HNSW index on `code_chunks.embedding`:
```sql
CREATE INDEX ON code_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```
`match_code_chunks` RPC sets `hnsw.ef_search = 100` per request.

---

## IssuesPanel Groups (in display order)

| Issue type | Label | Icon |
|---|---|---|
| `vulnerable_dependency` | Vulnerable Dependencies | Package |
| `hardcoded_secret` | Hardcoded Secrets | Lock |
| `missing_auth` | Potentially Unauthenticated Routes | AlertTriangle |
| `insecure_pattern` | Insecure Code Patterns | ShieldAlert |
| `circular_dependency` | Circular Dependencies | GitMerge |
| `god_file` | God Files | FileWarning |
| `high_coupling` | High Coupling | Link2 |
| `dead_code` | Dead Code | FileX |

Suppression actions:
- `hardcoded_secret` → "Mark as false positive" (requires `Rule ID:` + `line N` in description)
- `missing_auth` → "Mark as intentionally public" (uses `line_number: 0` sentinel)
- `insecure_pattern` → "Disable this rule" (writes to `repositories.sast_disabled_rules`)

---

## Testing

Test utilities: `backend/src/parsers/test-parser.js`, `backend/src/parsers/debug-ast.js`.
Frontend component tests exist under `frontend/src/components/__tests__/`. Backend integration tests in `backend/test/api.integration.test.js`.
Prefer Vitest for frontend, Jest or Vitest for backend.

---

## Linting

ESLint in both `frontend/` and `backend/`. No Prettier, no commit hooks. Run `npm run lint` inside each subdirectory. **Always lint before committing** — CI runs both.

---

## Architectural Conventions

- **Backend:** MVC-ish — routes → controllers → services → parsers/AI/db
- **Frontend:** Feature-based components, single AuthContext for session
- **Auth:** All backend routes validate Supabase JWT via `requireAuth` middleware
- **Error handling:** `express-async-errors` patches async routes; centralized error middleware
- **Concurrency:** `p-limit` controls concurrent file fetches; OSV enrichment limited to 5 concurrent requests
- **Incremental indexing:** Files with unchanged `content_hash` skip parsing and scanning; their DB state (including `node_classification`) is preserved as-is
- **SSE streaming:** AI review and security audit use Server-Sent Events; frontend reads with `ReadableStream` + `TextDecoder`; abort via `AbortController`

---

## Notes for Development

- Tree-sitter native modules require build tools (python3, make, g++) — `backend/Dockerfile.dev` handles this
- `docker-compose.yml` runs `npm install` on every container start for `backend` and `frontend` so new dependencies in `package.json` are picked up without a manual rebuild — the anonymous `/app/node_modules` volume otherwise persists across `docker compose build` and silently hides them
- Apply `scripts/schema.sql` + `scripts/us048_security_audits.sql` via Supabase SQL Editor before first run
- Frontend Vite proxy (`/api/*` → port 3001) configured in `frontend/vite.config.js`
- Attack surface toggle forces `clusteringEnabled = false` — clustering uses cluster-level edge IDs incompatible with individual-node path IDs
- `issue_suppressions` is rule-agnostic: `rule_id` is a free-text string, `line_number: 0` is the convention for file-level suppressions (used by `missing_auth`)
