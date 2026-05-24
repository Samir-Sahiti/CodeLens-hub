# CLAUDE.md — CodeLens Hub

## What This Project Is

CodeLens is a full-stack web app that helps developers understand large, unfamiliar codebases. Core capabilities:
- Interactive force-directed dependency graph (D3.js) with clustering, impact analysis, and attack surface overlay
- Architectural issue detection (circular deps, god files, dead code, high coupling)
- Security scanning: secret detection, SAST pattern matching, dependency vulnerability scanning, attack surface mapping, auth coverage checking
- AI security audit mode with whole-repo auditing and structured findings
- **AI refactor proposals** with one-click "Apply via PR" producing a draft GitHub PR in a single commit (US-063–US-066)
- AI-generated code tours / guided walkthroughs (US-060, US-061), with fork + share-impact
- Duplicate-code clustering + AI shared-utility refactor suggestion
- RAG-powered natural language code search
- File complexity/impact ("blast radius") analysis
- Per-file AI chat
- Team-shared repos (access via ownership or team membership)
- Auto-sync on `git push` via per-repo GitHub webhook

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
│   │   ├── IssuesPanel.jsx           # All issue types + duplication + "PR opened" badges (US-066)
│   │   ├── ProposalPanel.jsx         # AI refactor proposal review + Apply via PR (US-065, US-066)
│   │   ├── ImpactAnalysisPanel.jsx   # Blast-radius panel
│   │   ├── MetricsPanel.jsx
│   │   ├── SearchPanel.jsx
│   │   └── ui/                       # Primitives, Icons (lucide-react re-exports), Toast
│   ├── pages/              # Login, AuthCallback, Dashboard, RepoView, Search
│   ├── context/            # AuthContext
│   ├── hooks/
│   │   └── useGraphSimulation.js     # D3 physics + visual modes (selection/impact/attack surface)
│   └── lib/                # supabase.js client, api.js (apiUrl helper), constants.js, syntaxHighlighter
│
├── backend/src/
│   ├── index.js            # Express setup + all route mounting + global token-redacting console
│   ├── routes/             # auth, repo, search, analysis, review, webhooks, teams, fileChat, usage, admin, tours
│   ├── controllers/        # Request handlers
│   │   ├── analysisController.js     # Issues, suppress, impact
│   │   ├── reviewController.js       # AI review + security audit + refactor proposals + apply-via-PR (US-048, US-064–US-066)
│   │   ├── repoController.js         # Connect, upload, status, reindex, churn, duplication, branches, diff, dependencies
│   │   ├── teamController.js         # Team CRUD + repo sharing
│   │   ├── fileChatController.js     # Per-file AI chat
│   │   ├── toursController.js        # Code-tour generation/edit/fork (US-060, US-061)
│   │   ├── usageController.js        # /api/usage/today
│   │   ├── webhookController.js      # GitHub push → auto-reindex
│   │   ├── authController.js         # GitHub OAuth handshake
│   │   └── searchController.js       # RAG search
│   ├── services/           # Business logic
│   │   ├── indexer.js                # Top-level indexing entry
│   │   ├── indexerService.js         # Core indexing pipeline
│   │   ├── secretScanner.js          # Hardcoded secret detection (US-044)
│   │   ├── sastEngine.js             # AST-based SAST rules (US-046)
│   │   ├── authCoverageScanner.js    # Auth coverage check (US-049)
│   │   ├── attackSurfaceClassifier.js # Source/sink classification (US-047)
│   │   ├── manifestParser.js         # Dependency manifest parsing (US-045)
│   │   ├── osvScanner.js             # OSV.dev vulnerability lookup (US-045)
│   │   ├── duplicationScanner.js     # Cosine-similarity duplicate clustering over code_chunks
│   │   ├── churnService.js           # Per-file git churn from history
│   │   ├── diffService.js            # Structural (node/edge) diff between two refs (US-051)
│   │   ├── issueDetection.js         # Circular dep / god file / coupling / dead code
│   │   ├── startHereTourService.js   # Auto-generated "Start Here" tour
│   │   ├── testCoverageService.js    # Test/coverage file detection
│   │   ├── queue.js                  # Indexing job queue
│   │   └── usageTracker.js           # Daily token budget (US-042)
│   ├── sast/
│   │   ├── secret-rules.json         # Regex rules for secret scanning
│   │   └── rules/                    # Per-language SAST rules (US-046)
│   ├── parsers/            # Tree-sitter AST parsing per language
│   │   ├── parserPool.js             # Piscina worker pool singleton (Phase 5.1)
│   │   └── parser-worker.js          # Worker entry — JSON-safe parsed result
│   ├── lib/                # Shared helpers — dbHelpers, sseAbort, githubAuth
│   ├── observability/      # AsyncLocalStorage request ledger (Phase 0)
│   ├── ai/                 # ragService.js (RAG pipeline)
│   ├── db/                 # Supabase admin client (instrumented fetch)
│   └── middleware/         # Auth, error handling, AI rate limiting
│
├── scripts/
│   ├── setup.sh                              # Idempotent bootstrap
│   ├── schema.sql                            # Full DB schema — apply via Supabase SQL Editor
│   ├── us048_security_audits.sql             # security_audits table + RLS
│   ├── us051_arch_diff.sql                   # Architectural diff (US-051) support
│   ├── us063_proposals.sql                   # issue_proposals table + RLS + stale-detection (US-063)
│   ├── perf_reindex_migration.sql            # prepare_repo_reindex RPC migration
│   ├── maintenance_truncate_api_usage.sql    # Monthly — prune raw api_usage > 30 days
│   └── maintenance_evict_embedding_cache.sql # Quarterly — evict embedding_cache idle > 90 days
│
└── docker-compose.yml      # postgres + backend + frontend
```

---

## API Routes

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `*` | `/api/auth/*` | GitHub OAuth |
| `*` | `/api/repos/*` | Connect repos, upload ZIPs, list, status, re-index, delete; PATCH `auto_sync_enabled` / `sast_disabled_rules` |
| `GET` | `/api/repos/:id/status` | Indexing status (`pending \| indexing \| ready \| failed`) + per-stage readiness flags |
| `GET` | `/api/repos/:id/file` | File contents for the viewer (US-037, US-043) |
| `GET` | `/api/repos/:id/dependencies` | SCA vulnerability data (US-045) |
| `GET` | `/api/repos/:id/duplication` | Duplicate-code clusters |
| `GET` | `/api/repos/:id/churn` | Per-file git churn |
| `GET` | `/api/repos/:id/branches` | List branches (Octokit) |
| `GET` | `/api/repos/:id/diff` | Structural diff (node/edge changes) between two refs (US-051) |
| `GET` | `/api/repos/:id/webhook` | Generate a webhook secret for the repo |
| `*` | `/api/search/*` | RAG code search (Groq + pgvector HNSW) |
| `*` | `/api/analysis/*` | Graph, metrics, issues, impact |
| `POST` | `/api/analysis/:id/issues/suppress` | Suppress an issue (secrets + missing_auth) |
| `POST` | `/api/review/:id` | Single-file AI review or security audit |
| `POST` | `/api/review/:id/security-audit` | Whole-repo security audit (US-048) |
| `GET` | `/api/review/:id/security-audits` | Audit history |
| `GET` | `/api/review/:id/security-audits/:auditId` | Single audit |
| `POST` | `/api/review/:id/duplication-refactor` | SSE: AI shared-utility refactor for a duplicate cluster |
| `POST` | `/api/review/:id/issues/:issueId/proposals` | SSE: AI fix proposal for an `analysis_issues` row; `?regenerate=true` skips cache (US-064) |
| `PATCH` | `/api/review/:id/issues/:issueId/proposals/:proposalId` | Update proposal status (discard) |
| `GET` | `/api/review/:id/proposals/summary` | Latest proposal per issue for IssueCard badges (US-066) |
| `POST` | `/api/review/:id/proposals/:proposalId/apply` | Apply a proposal as a GitHub draft PR via single-commit Git Data API (US-066) |
| `POST` | `/api/file-chat/:id` | Per-file AI chat |
| `*` | `/api/tours/*` | Generate/list/update/fork/delete AI-authored code tours (US-060, US-061) |
| `*` | `/api/teams/*` | Create teams, add repos to teams, list team repos |
| `GET` | `/api/usage/today` | Today's per-user token usage (US-042) |
| `POST` | `/api/webhooks/github` | GitHub push webhook → auto-reindex when `auto_sync_enabled` is set |
| `*` | `/api/admin/*` | Internal/ops endpoints |

---

## Database Schema

Tables (all with RLS):
- `profiles` — user metadata + `github_token_secret_id` (UUID referencing Supabase Vault; tokens never stored plaintext — US-039)
- `repositories` — connected repos: `status` (`pending | indexing | ready | failed`), `full_name` (`owner/repo`), `default_branch`, `source` (`github | upload`), `auto_sync_enabled`, `sast_disabled_rules TEXT[]` for per-repo SAST rule opt-outs (US-046), `webhook_secret`
- `graph_nodes` — files with metrics: `line_count`, `complexity_score` (true cyclomatic via Tree-sitter), `incoming_count`, `outgoing_count`, `content_hash`, `node_classification` (`source | sink | both | null` — US-047)
- `graph_edges` — dependency edges (`from_path → to_path`); `symbols TEXT[]` carries per-importer symbol list (US-064)
- `code_chunks` — chunked source with 1536-dim pgvector embeddings (HNSW index m=16, ef_construction=64)
- `file_contents` — full file bodies keyed by `(repo_id, file_path)`; backs AI review retrieval (US-043) and `read_file` tool calls
- `analysis_issues` — issue types: `circular_dependency | god_file | dead_code | high_coupling | hardcoded_secret | insecure_pattern | vulnerable_dependency | missing_auth | refactoring_candidate`
- `issue_suppressions` — per-instance suppression: `{ repo_id, file_path, rule_id, line_number, created_by, created_at }` — used by secrets (US-044) and missing_auth (US-049)
- `vulnerability_cache` — OSV.dev results per `(ecosystem, name, version)` with 24 h TTL (US-045)
- `dependency_manifests` — per-package SCA results for the Dependencies tab; cleared on re-index (US-045)
- `security_audits` — whole-repo AI audit reports: `{ id, user_id, repo_id, findings_json, status, created_at }` (US-048); `status` supports `partial` when the daily budget runs out mid-audit
- `api_usage` — per-user token usage log (audit/debug; truncated monthly — see Maintenance)
- `api_usage_daily` — `(user_id, usage_date)` rollup maintained by an `AFTER INSERT` trigger on `api_usage`; read by every budget check so the rolling-24 h scan never grows
- `issue_proposals` — AI fix proposals for `analysis_issues` (US-063); status `pending | applied | discarded | stale`; carries `proposal_json` (`{ summary, rationale, changes[], risks }`), `prompt_tokens`, `completion_tokens`, plus `branch_name` + `pr_url` populated after US-066 Apply via PR. Re-index marks proposals `stale` when their underlying file changes
- `embedding_cache` — global, content-hash-keyed OpenAI embedding cache; rows shared across repos and accessed only via `service_role`. `last_used_at` drives quarterly eviction
- `duplication_candidates` — output of the cosine-similarity clustering pass over `code_chunks`; rendered as the "Duplication" section in IssuesPanel and as the source for `POST /api/review/:id/duplication-refactor`
- `tours` — AI-authored code tours (US-060, US-061): ordered steps with file/line anchors and prose; supports forking with a `forked_from` lineage column used by the share-impact endpoint
- `teams`, `team_members`, `team_repositories` — team-based repo sharing; access checks centralised in the `can_access_repo(repo_id, user_id)` Postgres RPC

**Schema migration:** `scripts/schema.sql` is idempotent and safe to re-run. Apply via Supabase SQL Editor. Auxiliary migrations applied separately on top: `us048_security_audits.sql`, `us051_arch_diff.sql`, `us063_proposals.sql`, `perf_reindex_migration.sql`.

**Indexer-side RPCs** (also in `scripts/schema.sql`):
- `prepare_repo_reindex(repo_id, unchanged_paths, changed_or_deleted_paths, preserve_churn)` — single PL/pgSQL call that stale-marks pending proposals, deletes non-preservable issues (preserves `hardcoded_secret` / `insecure_pattern` / `missing_auth` whose `file_paths` are entirely in `unchanged_paths`), wipes derived tables, and partial-purges nodes/chunks/file_contents for changed-or-deleted files
- `bulk_insert_analysis_issues(repo_id, issues jsonb)` — single insert with server-side shape validation (`type` non-null, `file_paths` non-empty)

---

## Environment Variables

Required in `.env` (see `.env.example`):

```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_URL, VITE_API_PROXY_TARGET
GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_CALLBACK_URL
OPENAI_API_KEY        # for text-embedding-3-small
GROQ_API_KEY          # for RAG LLM responses
ANTHROPIC_API_KEY     # for AI code review + security audit + refactor proposals (US-048, US-064)
NODE_ENV, PORT
FRONTEND_URL          # base URL used in CORS + as the deep-link host in Apply-via-PR PR bodies (US-066)
MAX_DAILY_TOKENS_PER_USER   # optional, default 500000 (US-042)

# Performance / observability knobs (all optional)
SLOW_REQUEST_MS             # WARN threshold for the request-timing middleware, default 500
LOG_REQUEST_TIMING          # 'true' → log every request, not only slow ones
SUPABASE_FETCH_CEILING      # row limit on bulk SELECTs, default 50000 (Phase 1.2)
PARSER_WORKER_COUNT         # piscina pool size; default = min(os.cpus().length, 8)
PARSER_WORKERS_DISABLED     # 'true' → skip the worker pool, parse in-process
```

---

## Indexing Pipeline (Core Flow)

Per-file scanning runs inside a `p-limit` concurrency pool. Tree-sitter parsing for non-`.cs` files is offloaded to a **Piscina worker pool** (`backend/src/parsers/parserPool.js`) so multi-core hosts actually use multiple cores; `.cs` files stay in-process because the pre-pass tree is cached and reused by the main pass to avoid a double parse. All scanners are wrapped in try/catch — failures are logged and never block the pipeline.

1. Repo tree fetched (GitHub Octokit or uploaded ZIP)
2. Files filtered by supported extension; manifest files separated
3. Incremental hash check — unchanged files reuse their DB state. A single `prepare_repo_reindex` RPC then stale-marks pending proposals, deletes non-preservable issues, wipes derived tables, and partial-purges changed/deleted nodes/chunks/file_contents in one transactional call
4. Tree-sitter parses each changed file → imports, exports, cyclomatic complexity. JS/TS parsers also emit per-import symbol lists used by the proposal-context builder (US-064)
5. Per-file scanners run in the same loop:
   - **Secret scanner** (`secretScanner.js`) — regex rules + high-entropy catch-all; suppressions filtered via `suppSet` (US-044)
   - **SAST engine** (`sastEngine.js`) — AST-query rules per language; per-repo disabled rules respected (US-046)
   - **Auth coverage scanner** (`authCoverageScanner.js`) — detects route handlers with no auth middleware; suppressions filtered (US-049)
6. **Attack surface classifier** (`attackSurfaceClassifier.js`) — classifies each file as `source | sink | both | null`; stored as `node_classification` on the graph node (US-047)
7. Dependency graph upserted (`graph_nodes` + `graph_edges`); metrics (incoming/outgoing counts) computed in-memory then persisted
8. Architectural issue detection: circular dependencies (DFS), god files, high coupling, dead code
9. SCA: manifest files parsed → OSV.dev batch query → `vulnerability_cache` + `dependency_manifests` + `analysis_issues` (US-045)
10. All collected issues bulk-inserted via `bulk_insert_analysis_issues` (single RPC instead of chunked inserts)
11. File contents stored in `file_contents` table for AI review retrieval (US-043)
12. Semantic chunks: each chunk's `sha256(content)` is looked up in `embedding_cache` first; only cache misses go to OpenAI. New embeddings are upserted into the cache and `last_used_at` is bumped on hits

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

## AI Refactor Proposals (US-063 – US-066)

A one-click "Propose fix" path on every issue card. The model receives the issue, the file, and structural context relevant to the issue type, then emits a structured proposal containing both unified diffs (for display) and full file contents (for application). The user can apply the proposal as a draft GitHub PR.

**Schema (US-063):** `issue_proposals` — see Database Schema above.

**Generation (US-064)** — `backend/src/controllers/reviewController.js`:
- `POST /api/review/:repoId/issues/:issueId/proposals` (SSE, `requireAuth` + `aiRateLimit`); optional `?regenerate=true` skips the per-issue cache.
- Per-issue-type structural context bundles:
  - `god_file` → file + per-importer symbol breakdown (uses `graph_edges.symbols`)
  - `circular_dependency` → all files in the cycle + interconnecting edges
  - `high_coupling` → file + top-5 neighbours with aggregated symbol use
  - `dead_code` → file + zero-incoming-edges confirmation
  - `missing_auth` → route file + existing auth patterns visible nearby
  - `hardcoded_secret` → ±10 lines around the secret + `.env.example` if present
  - `vulnerable_dependency` → manifest + safe-version target
- Structured output: `{ summary, rationale, changes: [{ file_path, action: 'create'|'modify'|'delete', diff, full_content }], risks }`
- SSE events: `summary_delta`, `rationale_delta`, `change`, `risk`, `done` (carries `prompt_tokens` + `completion_tokens`), `error`
- `normalizeProposal` validates that every `create` / `modify` change has non-empty `full_content`; missing contents are surfaced as `risks` and block Apply via PR

**Review panel (US-065)** — `frontend/src/components/ProposalPanel.jsx`:
- Slide-in panel with `Summary`, `Rationale`, per-file `Changes` (unified-diff renderer via `react-syntax-highlighter` with green/red/dimmed line classes), and `Risks`.
- Stale banner with a one-click Regenerate.
- Action row: **Discard** (PATCH), **Regenerate** (`?regenerate=true`), **Copy diff**, **Apply via PR**. Token-cost line in the header.

**Apply via PR (US-066)** — single-commit Git Data API flow:
- `POST /api/review/:repoId/proposals/:proposalId/apply`
- Pulls the user's PAT via `backend/src/lib/githubAuth.js::getGithubTokenForUser` (Supabase Vault).
- Resolves `default_branch` → `getRef` → `getCommit` → for each change `createBlob` (or `sha: null` for delete) → `createTree` (with `base_tree`) → `createCommit` → `createRef refs/heads/codelens/refactor/<id-prefix>-<slug>` → `pulls.create({ draft: true })`.
- Slug: `<issue_type>-<basename(file)>`, lowercased, `[^a-z0-9]+ → '-'`, truncated to 40 chars.
- PR body embeds the rationale, risks, and a deep link back to the CodeLens issue (`FRONTEND_URL`).
- Idempotent: if `status='applied'` and `pr_url` is set, returns existing values without retrying GitHub. If the branch already exists on GitHub, the endpoint reuses the open PR or fast-forwards the ref.
- Error mapping (no raw GitHub error text): 401 (token revoked), 403 (no write access), 404 (file disappeared), 422 (branch / encoding), 5xx / 429 → 502 "temporarily unavailable", missing `full_content` → 422 "regenerate it".
- On success: `withSupabaseRetry`-wrapped update sets `status='applied'`, `branch_name`, `pr_url`.

**IssueCard apply badge (US-066):** `IssuesPanel.jsx` fetches `GET /api/review/:repoId/proposals/summary` on mount → latest proposal per issue. Cards whose latest proposal is `applied` render a green "PR opened" badge linking to `pr_url`, and the "Propose fix" button relabels to "Open proposal". `ProposalPanel` calls back via `onApplied` so the badge appears optimistically without a re-fetch.

---

## Duplication Detection

`backend/src/services/duplicationScanner.js` — cosine-similarity clustering over `code_chunks` embeddings, persisted to `duplication_candidates`.

- **`GET /api/repos/:id/duplication`** returns clusters with `{ severity, member_count, total_lines, similarity_min, similarity_max, members[] }`.
- **`IssuesPanel.jsx` → DuplicationSection / DuplicationDetailModal** — side-by-side picker comparing any two cluster members with syntax-highlighted source.
- **`POST /api/review/:id/duplication-refactor`** — SSE-streamed Claude proposal for extracting a shared utility across a cluster.

---

## Code Tours (US-060, US-061)

`backend/src/controllers/toursController.js` + `backend/src/services/startHereTourService.js` — AI-authored guided walkthroughs.

- **Generate** (`POST /:repoId/tours/generate`, `aiRateLimit`) — Claude writes an ordered list of steps anchored to specific files/lines with prose.
- **List / Update / Delete** — tours persist per `(user_id, repo_id)`.
- **Fork** (US-061, `POST /:repoId/tours/:tourId/fork`) — branches off another user's tour, tracking lineage in a `forked_from` column.
- **Share-impact** (US-061, `GET /:repoId/tours/:tourId/share-impact`) — reports forks downstream of a tour so the author understands the blast radius of an edit.
- **Start Here tour** — auto-generated from repo structure as the first tour suggested to a new user.

---

## Teams (Shared Repos)

`backend/src/controllers/teamController.js` — team-based repo sharing.

- Tables `teams`, `team_members`, `team_repositories` (all RLS-enabled).
- Routes: `POST /api/teams`, `GET /api/teams`, `POST /api/teams/:teamId/repos`, `GET /api/teams/:teamId/repos`.
- Access centralised in `can_access_repo(repo_id, user_id)` RPC — returns true if the user owns the repo OR is a member of a team that includes it. Every read/write controller calls this helper before touching repo-scoped data.

---

## Auto-Sync via GitHub Webhooks

`backend/src/routes/webhooks.js` + `backend/src/controllers/webhookController.js`.

- `POST /api/webhooks/github` runs before `express.json()` (mounted via `express.raw({ type: 'application/json' })`) so the HMAC signature validator sees the original request bytes.
- Each repo has a `webhook_secret` generated via `GET /api/repos/:id/webhook`.
- On `push` events for repos with `auto_sync_enabled = true`, the backend kicks an incremental re-index; the global Vault-stored PAT is reused for the GitHub fetch.

---

## Per-File AI Chat

`backend/src/controllers/fileChatController.js` — `POST /api/file-chat/:repoId` accepts a file path + a question and streams a Claude response grounded in the file content. Reuses the per-user daily token budget.

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
| `refactoring_candidate` | Refactoring Candidates | TrendingUp |

Each card also exposes a **"Propose fix"** action (US-064) and, once a proposal has been applied via PR, a green **"PR opened"** badge linking to the draft PR (US-066). Duplicate-code clusters render below in a separate section.

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
- **SSE streaming:** AI review and security audit use Server-Sent Events; frontend reads with `ReadableStream` + `TextDecoder`; abort via `AbortController`. Server-side, every Claude stream binds `req.on('close')` to an `AbortController` via `backend/src/lib/sseAbort.js` (`bindRequestAbort` / `isAbortError`) so a closed tab stops generating tokens mid-stream
- **Shared backend helpers** (`backend/src/lib/`):
  - `dbHelpers.js` — `SAFE_FETCH_CEILING` + `warnIfCeilingHit` for bulk `.range(0, SAFE_FETCH_CEILING - 1)` selects; `withSupabaseRetry(fn, { tries, baseMs, label })` for critical writes (retries on 5xx / 429 / network errors only)
  - `sseAbort.js` — `bindRequestAbort(req)` returns `{ signal, cleanup, isAborted }`; pass `signal` to any upstream SDK call and call `cleanup()` in `finally`
  - `githubAuth.js` — `getGithubTokenForUser(userId)` resolves the user's `github_token_secret_id` from `profiles` and reads the plaintext PAT via the `get_github_token_secret` Vault RPC (US-039). Used by `repoController` for re-indexing and by `reviewController` for Apply via PR (US-066)
- **Observability (Phase 0):** every request runs inside an `AsyncLocalStorage` ledger (`backend/src/observability/requestStore.js`); the Supabase client's custom fetch records `(method, table, durationMs, status)` per round-trip. Requests slower than `SLOW_REQUEST_MS` log a one-line summary with the top 3 DB calls. Set `LOG_REQUEST_TIMING=true` to log every request

---

## Notes for Development

- Tree-sitter native modules require build tools (python3, make, g++) — `backend/Dockerfile.dev` handles this
- `docker-compose.yml` runs `npm install` on every container start for `backend` and `frontend` so new dependencies in `package.json` are picked up without a manual rebuild — the anonymous `/app/node_modules` volume otherwise persists across `docker compose build` and silently hides them
- Apply `scripts/schema.sql` then the auxiliary migrations (`us048_security_audits.sql`, `us051_arch_diff.sql`, `us063_proposals.sql`, `perf_reindex_migration.sql`) via the Supabase SQL Editor before first run
- Frontend Vite proxy (`/api/*` → port 3001) configured in `frontend/vite.config.js`
- Attack surface toggle forces `clusteringEnabled = false` — clustering uses cluster-level edge IDs incompatible with individual-node path IDs
- `issue_suppressions` is rule-agnostic: `rule_id` is a free-text string, `line_number: 0` is the convention for file-level suppressions (used by `missing_auth`)

---

## Maintenance

Periodic SQL snippets in [scripts/](scripts/) — apply via Supabase SQL Editor. No pg_cron required.

- `maintenance_truncate_api_usage.sql` — monthly. Deletes `api_usage` rows older than 30 days. The rolling budget is served by `api_usage_daily` (trigger-maintained rollup), so raw `api_usage` is only needed for audit/debugging.
- `maintenance_evict_embedding_cache.sql` — quarterly. Removes `embedding_cache` rows whose `last_used_at` is older than 90 days. The cache is keyed by chunk content hash and shared across repos.
