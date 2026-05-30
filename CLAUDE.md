# CLAUDE.md — CodeLens Hub

## What This Project Is

CodeLens is a full-stack web app that helps developers understand large, unfamiliar codebases. Core capabilities:
- Interactive force-directed dependency graph (D3.js) with clustering, impact analysis, and attack surface overlay
- Architectural issue detection (circular deps, god files, dead code, high coupling)
- Security scanning: secret detection, SAST pattern matching, dependency vulnerability scanning, attack surface mapping, auth coverage checking
- AI security audit mode with whole-repo auditing and structured findings
- **PR review workflow** — deterministic scanners + blast radius run on a PR diff, persisted, viewable in-app, and posted back as inline GitHub review comments (US-072–US-075)
- **CI status check** — a GitHub Action + per-repo CI API token that runs the PR review from CI and reports a pass/fail check (US-076)
- **In-app notifications** — bell + feed for index/issue/vulnerability/PR-review/tour events, with 30-day dedup (US-077)
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
│   │   ├── IssueCard.jsx             # Shared issue/finding card (reused by Issues + PR review — US-075)
│   │   ├── ProposalPanel.jsx         # AI refactor proposal review + Apply via PR (US-065, US-066)
│   │   ├── PullRequestsPanel.jsx     # PR review viewer: list + full-page detail + findings (US-075)
│   │   ├── NotificationBell.jsx      # Sidebar bell + dropdown feed; exports shared type meta (US-077)
│   │   ├── SettingsPanel.jsx         # Auto-sync, auto-publish, PR-review severity, CI token gen (US-073/076)
│   │   ├── ImpactAnalysisPanel.jsx   # Blast-radius panel
│   │   ├── MetricsPanel.jsx
│   │   ├── AgentPanel.jsx            # AI Repo Agent chat + tool-call cards + history rail (US-070, US-071)
│   │   └── ui/                       # Primitives, Icons (lucide-react re-exports), Toast
│   ├── pages/              # Login, AuthCallback, Dashboard, RepoView, NotificationsPage (US-077)
│   ├── context/            # AuthContext
│   ├── hooks/
│   │   └── useGraphSimulation.js     # D3 physics + visual modes (selection/impact/attack surface)
│   └── lib/                # supabase.js client, api.js (apiUrl helper), constants.js, syntaxHighlighter
│
├── backend/src/
│   ├── index.js            # Express setup + all route mounting + global token-redacting console
│   ├── routes/             # auth, repo, search, analysis, review, reviews, webhooks, teams, fileChat, usage, admin, tours, agent, notifications
│   ├── controllers/        # Request handlers
│   │   ├── analysisController.js     # Issues, suppress, impact
│   │   ├── reviewController.js       # AI review + security audit + refactor proposals + apply-via-PR + PR review pipeline/publish/ci-check (US-048, US-064–US-066, US-072–US-076)
│   │   ├── repoController.js         # Connect, upload, status, reindex, churn, duplication, branches, diff, dependencies
│   │   ├── ciTokenController.js      # Per-repo CI API token generate/list/revoke (US-076)
│   │   ├── notificationsController.js # In-app notification feed endpoints (US-077)
│   │   ├── teamController.js         # Team CRUD + repo sharing
│   │   ├── fileChatController.js     # Per-file AI chat
│   │   ├── toursController.js        # Code-tour generation/edit/fork + tour_shared notify (US-060, US-061, US-077)
│   │   ├── usageController.js        # /api/usage/today
│   │   ├── webhookController.js      # GitHub push → auto-reindex (gated on auto_sync_enabled); pull_request → PR review (US-073)
│   │   ├── authController.js         # GitHub OAuth handshake
│   │   ├── agentController.js        # AI Repo Agent tool-use loop + history (US-069 – US-071)
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
│   │   ├── graphService.js           # BFS/DFS over graph_edges + Tarjan cycle count (US-068)
│   │   ├── fileService.js            # Indexed file read (file_contents + code_chunks fallback)
│   │   ├── agentTools.js             # Anthropic-schema tools + handlers for the agent (US-068)
│   │   ├── notificationEvents.js     # In-process EventEmitter (pr_review.ready) — test-observable (US-073)
│   │   ├── notifications.js          # enqueueNotification (30-day dedup) + recipientsForRepo (US-077)
│   │   ├── queue.js                  # Indexing + pr-review job queue
│   │   └── usageTracker.js           # Daily token budget (US-042)
│   ├── sast/
│   │   ├── secret-rules.json         # Regex rules for secret scanning
│   │   └── rules/                    # Per-language SAST rules (US-046)
│   ├── parsers/            # Tree-sitter AST parsing per language
│   │   ├── parserPool.js             # Piscina worker pool singleton (Phase 5.1)
│   │   └── parser-worker.js          # Worker entry — JSON-safe parsed result
│   ├── lib/                # Shared helpers — dbHelpers, sseAbort, githubAuth, repoAccess
│   ├── observability/      # AsyncLocalStorage request ledger (Phase 0)
│   ├── ai/                 # ragService.js (RAG pipeline)
│   ├── db/                 # Supabase admin client (instrumented fetch)
│   └── middleware/         # Auth (requireAuth), ciTokenAuth (US-076), error handling, AI rate limiting
│
├── .github/actions/codelens-review/   # Zero-dep Node 20 GitHub Action for CI status check (US-076)
├── docs/ci-integration.md             # CI integration guide + copy-paste workflow YAML (US-076)
│
├── scripts/
│   ├── setup.sh                              # Idempotent bootstrap
│   ├── schema.sql                            # Full DB schema — apply via Supabase SQL Editor
│   ├── us048_security_audits.sql             # security_audits table + RLS
│   ├── us051_arch_diff.sql                   # Architectural diff (US-051) support
│   ├── us063_proposals.sql                   # issue_proposals table + RLS + stale-detection (US-063)
│   ├── us067_agent.sql                       # agent_conversations + agent_messages tables + RLS (US-067)
│   ├── graph_indexes_cleanup.sql             # Drops redundant single-column indexes on graph_edges
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
| `POST` | `/api/review/:id/pr-findings/proposals` | SSE: AI fix proposal for a PR-review finding (US-075) |
| `PATCH` | `/api/review/:id/pr-findings/proposals/:proposalId` | Update PR-finding proposal status (discard) (US-075) |
| `POST` | `/api/review/:id/pr-findings/proposals/:proposalId/apply` | Apply a PR-finding proposal as a draft PR (US-075) |
| `GET` | `/api/repos/:id/pulls` | List PRs (Octokit) with their latest review (US-075) |
| `GET\|POST` | `/api/repos/:id/pulls/:number/reviews` | List PR review history / run a deterministic PR review (SSE) (US-073) |
| `POST` | `/api/repos/:id/pulls/:number/reviews/ci-check` | CI-token-auth: blocks until review ready, returns pass/fail (US-076) |
| `POST` | `/api/repos/:id/reviews/:reviewId/publish` | Post the review to GitHub as inline comments (US-074) |
| `GET` | `/api/reviews/:reviewId` | Full PR review detail incl. stale-index banner data (US-075) |
| `POST\|GET\|DELETE` | `/api/repos/:id/ci-tokens[/:tokenId]` | Generate (once) / list / revoke per-repo CI API tokens (US-076) |
| `GET` | `/api/notifications` | Cursor-paginated feed `?limit&before` (US-077) |
| `GET` | `/api/notifications/unread-count` | Unread badge count (US-077) |
| `POST` | `/api/notifications/:id/read` \| `/api/notifications/mark-all-read` | Mark one / all read (US-077) |
| `POST` | `/api/file-chat/:id` | Per-file AI chat |
| `POST` | `/api/repos/:id/agent/chat` | SSE: AI Repo Agent tool-use loop (US-069). Body `{ conversation_id?, message }` |
| `GET` | `/api/repos/:id/agent/conversations` | Paginated conversation list (US-071) |
| `GET` | `/api/repos/:id/agent/suggestions` | 4 repo-tailored example prompts for the empty state (US-070) |
| `GET\|PATCH\|DELETE` | `/api/agent/conversations/:id` | Load / rename / delete a single conversation (US-071) |
| `*` | `/api/tours/*` | Generate/list/update/fork/delete AI-authored code tours (US-060, US-061) |
| `*` | `/api/teams/*` | Create teams, add repos to teams, list team repos |
| `GET` | `/api/usage/today` | Today's per-user token usage (US-042) |
| `POST` | `/api/webhooks/github` | GitHub webhook → push auto-reindex (when `auto_sync_enabled`); `pull_request` → PR review (when `pr_review_enabled`) |
| `*` | `/api/admin/*` | Internal/ops endpoints |

---

## Database Schema

Tables (all with RLS):
- `profiles` — user metadata + `github_token_secret_id` (UUID referencing Supabase Vault; tokens never stored plaintext — US-039)
- `repositories` — connected repos: `status` (`pending | indexing | ready | failed`), `full_name` (`owner/repo`), `default_branch`, `source` (`github | upload`), `auto_sync_enabled`, `sast_disabled_rules TEXT[]` for per-repo SAST rule opt-outs (US-046), `webhook_secret`, `latest_indexed_sha` (drives PR-review stale-index banner), and PR-review flags `pr_review_enabled` / `pr_review_auto_publish` / `pr_review_block_on_severity` (`critical | high`) (US-073/074)
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
- `agent_conversations` — AI Repo Agent chats (US-067): `{ id, repo_id, user_id, title, total_tokens, created_at, updated_at }`. `title` is auto-generated by a one-shot Haiku call after the first assistant turn.
- `agent_messages` — full tool-call trace for the agent (US-067). `role` enum `user | assistant | tool_use | tool_result`; `content_json` is polymorphic by role (`{ text }` for user/assistant, `{ tool_name, input, tool_use_id }` for tool_use, `{ tool_use_id, output, is_error }` for tool_result). `tool_use_id` matches Anthropic's protocol id so traces replay verbatim.
- `pr_reviews` — per-PR-head deterministic review (US-072): `{ id, repo_id, pr_number, pr_head_sha, pr_base_sha, user_id, status (pending|analyzing|ready|failed|stale), findings_json, summary, total_findings, severity_counts }`. Unique `(repo_id, pr_number, pr_head_sha)`; a re-push marks the prior review `stale`. `findings_json` mirrors `analysis_issues` shape so `IssueCard` renders either source
- `pr_review_comments` — GitHub comment ids for idempotent (re-)publishing (US-074): `{ review_id, github_comment_id, file_path, line_number, kind (inline|summary) }`
- `pr_finding_proposals` — AI fix proposals for PR-review findings (US-075), mirrors `issue_proposals` but keyed by `(review_id, finding_id)`; `status`, `proposal_json`, `branch_name`, `pr_url`
- `repo_api_tokens` — per-repo CI API tokens (US-076): `{ id, repo_id, token_hash, name, created_by, created_at, last_used_at, revoked_at }`. Stored as HMAC-SHA256(`CI_TOKEN_HMAC_SECRET`, token); plaintext shown once
- `notifications` — in-app feed (US-077): `{ id, user_id, repo_id, type, severity (info|warning|critical), payload_json, link_url, read_at, created_at }`. `type` enum `new_critical_issue | new_vulnerability | index_ready | index_failed | pr_review_ready | proposal_shared | tour_shared | webhook_paused`. Indexes on `(user_id, read_at, created_at DESC)` and `(user_id, repo_id, type, created_at DESC)` (the latter powers 30-day dedup)

**Schema migration:** `scripts/schema.sql` is idempotent and safe to re-run. Apply via Supabase SQL Editor. The PR-review (US-072), CI-token (US-076), and notifications (US-077) tables are appended to `scripts/schema.sql` directly. Auxiliary migrations applied separately on top: `us048_security_audits.sql`, `us051_arch_diff.sql`, `us063_proposals.sql`, `us067_agent.sql`, `perf_reindex_migration.sql`.

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
AGENT_MAX_ITERATIONS        # max tool-use iterations per agent turn, default 15 (US-069)
AGENT_TOKEN_CAP             # per-conversation cumulative token cap, default 50000 (US-069)
CI_TOKEN_HMAC_SECRET        # server secret used to HMAC-hash per-repo CI API tokens (US-076)

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

## AI Repo Agent (US-067 – US-071)

A conversational surface that drives an Anthropic tool-use loop over CodeLens's deterministic analysis. Replaces the old "Search" tab — the existing RAG retrieval is now one tool (`search_code`) among many. Conversations and the full tool-call trace persist so investigations resume across sessions and are auditable.

**Schema (US-067):** `agent_conversations` + `agent_messages` (see Database Schema above). `content_json` is polymorphic by role; `tool_use_id` matches Anthropic's protocol id so traces replay verbatim.

**Tool surface (US-068)** — `backend/src/services/agentTools.js` exports `{ tools, toolHandlers, isReadOnlyTool }`. 12 tools:
- `get_graph_overview` — `{ nodeCount, edgeCount, topHubs, topSinks, cyclicComponentCount }` (counts strongly-connected components containing a cycle — a 10-file cycle is one component, not 10 cycles)
- `list_issues({ type?, severity?, file? })` — sorted high → low by severity in JS (Supabase string ordering would put `medium` before `low`)
- `get_file_metrics({ path })`, `get_blast_radius({ path, depth? })` — `direct` (depth 1) and `transitive` (depth ≥ 2) are DISJOINT arrays so the count is `direct.length + transitive.length`; matches the Impact Analysis panel exactly, `get_dependents`, `get_imports`
- `find_paths({ from_path, to_path })`, `get_attack_paths({ source?, sink? })`
- `search_code({ query, top_k? })` — wraps `ragService.embedQuery` + `retrieveChunks`; returns raw chunks, no synthesis
- `read_file({ path, start_line?, end_line? })` — via `fileService.readFile`
- `get_vulns({ severity? })` — wraps `repoController.getStoredDependenciesWithIssues`
- `propose_fix({ issue_id })` — only write-side tool. Calls `reviewController._private` (`fetchAnalysisIssue`, `buildContextForIssue`, `streamClaude`, `parseProposalJson`, `normalizeProposal`) non-HTTP and inserts into `issue_proposals`. Returns `{ proposal_id, summary, change_count, risk_count }`.

Every handler gates on `canAccessRepo(repoId, userId)` first (per-call — a crafted prompt could swap repo ids between turns). Failures return `{ is_error: true, message }`; collection-returning tools cap at 50 rows with a `truncated` flag.

**Shared graph helpers (`backend/src/services/graphService.js`):** `getGraphOverview`, `getBlastRadius` (head-pointer BFS over the REVERSE import edges — change propagates to files that import the target; returns disjoint `direct` / `transitive` sets), `findPaths` (DFS), `getAttackPaths` (DFS from `source/both` nodes to `sink/both` nodes; records paths but keeps exploring past intermediate sinks to match the on-graph visualisation), `countCycles` (iterative Tarjan's SCC — recursive variant blew the stack on repos with ~10K-node SCCs). `buildAdjacency` accepts an optional valid-node Set so phantom edge targets (`'react'`, `'fs'`, unresolved relative imports) are filtered out of all traversals. Loaders (`loadEdges`, `loadNodes`) are memoised per-request via `AsyncLocalStorage` ([observability/requestStore.js](backend/src/observability/requestStore.js)) so multiple agent tools in one Anthropic iteration share a single Supabase fetch. Also wires the previously stubbed analysis routes (`/graph`, `/metrics`, `/impact/:filePath`) to real implementations — the `/impact/:filePath` endpoint is now the single source of truth for blast radius and is consumed by the frontend Impact panel via [RepoView.jsx](frontend/src/pages/RepoView.jsx) `useEffect`.

**Loop endpoint (US-069)** — `backend/src/controllers/agentController.js::chat` (`POST /api/repos/:repoId/agent/chat`, `requireAuth` + `aiRateLimit`):
- Streams SSE events: `conversation_created`, `text_delta`, `tool_use`, `tool_result`, `finish`, `budget_stopped`, `error`.
- Persistence-as-you-go: every `assistant` text, `tool_use`, and `tool_result` is INSERTed into `agent_messages` before the next Anthropic call. A dropped connection leaves the conversation resumable.
- Each iteration reads `agent_conversations.total_tokens` fresh; if `>= AGENT_TOKEN_CAP` (default 50 000) emits `budget_stopped` and ends.
- Loop bound by `AGENT_MAX_ITERATIONS` (default 15). Read-only tools run in `Promise.all`; `propose_fix` runs sequentially.
- Rehydration (`_private.rehydrateMessages`): consecutive `assistant` + `tool_use` rows fold into one Anthropic assistant message; consecutive `tool_result` rows fold into one user message.
- Title generation: fire-and-forget Haiku (`claude-haiku-4-5-20251001`) call after the first assistant turn completes; only updates `title` if it is still null.
- Suggestions (`GET /api/repos/:repoId/agent/suggestions`) computes 4 repo-tailored example prompts based on what `analysis_issues` actually contain, with generic fallbacks. `requireAuth` only, no `aiRateLimit`.

**History (US-071):** `GET /api/repos/:repoId/agent/conversations` (20/page), `GET /api/agent/conversations/:id`, `PATCH /api/agent/conversations/:id`, `DELETE /api/agent/conversations/:id`. RLS enforces user ownership.

**Frontend (`frontend/src/components/AgentPanel.jsx`):**
- Streaming markdown rendered with the existing `AnswerBlock` from `SharedAnswerComponents`.
- Collapsible `ToolCallCard` per tool call with verb-mapped header (`Computing blast radius of \`auth.js\``); raw input/output JSON visible on expand.
- `text_delta` arriving AFTER any completed tool call in the current bubble starts a fresh assistant bubble — that way iterations are visually separated even when a single iteration emits multiple tool_uses.
- `propose_fix` tool_result renders a `ProposalPreviewCard` with summary + `View in Issues` button that switches the tab via `onSwitchTab` callback from `RepoView`. IssuesPanel's existing `proposals/summary` fetch then surfaces the freshly-applied proposal on the matching issue card.
- Conversation rail with inline rename (click pencil) and delete-with-confirm (click trash).
- Cancel button during streaming aborts the `fetch` via `AbortController`.

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
- On `push` events for repos with `auto_sync_enabled = true`, the backend kicks an incremental re-index; the global Vault-stored PAT is reused for the GitHub fetch. (The repo lookup no longer filters on `auto_sync_enabled` — `pull_request` events have their own opt-in — so the push branch re-checks the flag explicitly before re-indexing.)
- On `pull_request` events (`opened | synchronize | reopened`) for repos with `pr_review_enabled = true`, the backend enqueues a `pr-review` job (US-073).

---

## PR Review Workflow (US-072 – US-075)

Deterministic-only review of a PR diff (no AI tokens in the pipeline), persisted and viewable in-app, optionally posted to GitHub as inline review comments.

- **Pipeline** (`reviewController.runPrReviewBackground`): fetch the PR (Octokit), stale-mark prior reviews for the PR, upsert a `pr_reviews` row, cap to the 50 files with the most additions (emit `truncated`), then per file run secret scan (added lines), SAST (full new content, only findings on added lines AND absent from base), auth-coverage (new vs base), and SCA on changed manifests. Blast radius is attached from the most recent index. Findings are filtered against `issue_suppressions` and pre-PR `analysis_issues`, then written to `findings_json`. SSE events: `analyzing_file | finding | truncated | summary | done | error`.
- **Triggers**: `POST /api/repos/:id/pulls/:number/reviews` (SSE, `requireAuth`) or the `pull_request` webhook → `pr-review` queue job.
- **Publish (US-074)**: `POST /api/repos/:id/reviews/:reviewId/publish` posts a single `pulls.createReview` (`COMMENT`, or `REQUEST_CHANGES` per `pr_review_block_on_severity`); inline findings → per-line comments, file-level → summary body; comment ids saved to `pr_review_comments`. Idempotent across re-pushes (cleans prior comments) and re-publishes of the same review (`resetCurrentReviewComments`). On 422, out-of-diff comments are dropped and it retries once. Auto-publishes when `pr_review_auto_publish`. Errors mapped (401/403/404/422/5xx) with no raw GitHub text.
- **Viewer (US-075)**: "Pull Requests" tab → `PullRequestsPanel` (list with status/severity, filters, 30s poll) → full-page detail (`GET /api/reviews/:reviewId`) reusing `IssueCard`, with "Generate fix" (`pr_finding_proposals`) and "Suppress". Stale-index banner when `latest_indexed_sha != pr_head_sha`.

---

## CI Status Check (US-076)

A GitHub Action that runs the PR review from CI and reports a status check.

- **Per-repo CI tokens**: `repo_api_tokens`, format `codelens_pat_<hex>`, stored as HMAC-SHA256(`CI_TOKEN_HMAC_SECRET`, token). Managed via `POST|GET|DELETE /api/repos/:id/ci-tokens[/:tokenId]` (`requireAuth` + `can_access_repo`); generated in Settings → CI Integration (shown once).
- **`ciTokenAuth` middleware** (`requireCiToken`): resolves `Authorization: Bearer codelens_pat_...` to a single repo via indexed hash lookup, enforces it matches `:repoId`, bumps `last_used_at`.
- **CI-check endpoint**: `POST /api/repos/:id/pulls/:number/reviews/ci-check` (CI-token auth) resolves the PR head SHA, reuses a `ready` review or **auto-triggers `runPrReviewBackground` and polls** until ready/timeout (default 300s, fail-closed), returns `{ status: 'pass'|'fail', severity_counts, summary_markdown, codelens_url }` based on `fail_on_severity` (default `critical,high`).
- **Action**: zero-dependency Node 20 action at `.github/actions/codelens-review/` (`action.yml` + `index.js`) — POSTs to ci-check, writes a check run via the GitHub checks API. See `docs/ci-integration.md`.

---

## Notifications (US-077)

In-app notification feed (no email/preferences — that's US-078).

- **Service** `backend/src/services/notifications.js`: `enqueueNotification({ user_ids, repo_id, type, severity, payload, link_url, dedup_key })` inserts one row per recipient; `dedup_key` skips users notified for the same `(repo, type, key)` in the last 30 days (prevents re-index spam). `recipientsForRepo(repoId)` = owner ∪ team members.
- **Emission** (all best-effort, wrapped in try/catch): indexer → `index_ready` (owner+team) / `index_failed` (owner) / per newly-surfaced critical-or-high issue → `new_critical_issue` or `new_vulnerability`; PR review → `pr_review_ready`; tour fork → `tour_shared` (original author). The legacy `notificationEvents.js` EventEmitter remains for test observability.
- **Endpoints** (`/api/notifications`, `requireAuth`, all user-scoped): `GET /` (`?limit&before` cursor), `GET /unread-count`, `POST /:id/read`, `POST /mark-all-read`.
- **Frontend**: `NotificationBell` in the `Layout` sidebar footer (60s badge poll, 30s dropdown poll, grouped by day, mark-all-read, click-outside) + `/notifications` full feed page (paginated 50). Shared type/severity meta + `notificationText` are exported from `NotificationBell.jsx`.

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
- Apply `scripts/schema.sql` then the auxiliary migrations (`us048_security_audits.sql`, `us051_arch_diff.sql`, `us063_proposals.sql`, `us067_agent.sql`, `perf_reindex_migration.sql`) via the Supabase SQL Editor before first run
- Frontend Vite proxy (`/api/*` → port 3001) configured in `frontend/vite.config.js`
- Attack surface toggle forces `clusteringEnabled = false` — clustering uses cluster-level edge IDs incompatible with individual-node path IDs
- `issue_suppressions` is rule-agnostic: `rule_id` is a free-text string, `line_number: 0` is the convention for file-level suppressions (used by `missing_auth`)

---

## Maintenance

Periodic SQL snippets in [scripts/](scripts/) — apply via Supabase SQL Editor. No pg_cron required.

- `maintenance_truncate_api_usage.sql` — monthly. Deletes `api_usage` rows older than 30 days. The rolling budget is served by `api_usage_daily` (trigger-maintained rollup), so raw `api_usage` is only needed for audit/debugging.
- `maintenance_evict_embedding_cache.sql` — quarterly. Removes `embedding_cache` rows whose `last_used_at` is older than 90 days. The cache is keyed by chunk content hash and shared across repos.
