# CodeLens — Feature Inventory

A snapshot of everything CodeLens does today. Written for planning conversations about future epics. Each section names the feature, what it does for the user, how it's implemented (briefly), and the user story (US-#) where applicable.

---

## 1. Repo Connection & Indexing

**What it does:** Onboards a codebase so every other feature has data to work with.

- **GitHub connect** — OAuth-based; the user's token is stored encrypted in Supabase Vault (US-039). Tokens are never logged in plaintext (global `console` redactor strips `ghp_/gho_/ghu_/...` strings).
- **ZIP upload** — for private/local repos with no GitHub connection.
- **Re-indexing** — manual via the UI, or automatic on push (see Webhooks).
- **Incremental indexing** — files whose `content_hash` is unchanged skip parse + scan; their DB state is preserved across re-indexes.
- **Indexing status** — pending → indexing → ready → failed, surfaced live in the dashboard.

Pipeline (per indexing run):
1. Repo tree fetched (Octokit) or ZIP extracted.
2. Tree-sitter AST parsing in a Piscina worker pool (multi-core); cyclomatic complexity computed (US-040).
3. Per-file scanners: secrets, SAST, auth coverage, attack-surface classification.
4. Dependency graph + metrics + architectural issues.
5. SCA: manifest files → OSV.dev → vulnerability cache (US-045).
6. Semantic chunking + 1536-dim embeddings (text-embedding-3-small), cache-keyed by content hash.

---

## 2. Dependency Graph (D3 Force Layout)

**What it does:** Interactive visualisation of the whole repo's structural dependency graph.

- **Force-directed layout** — D3.js v7, custom simulation in `useGraphSimulation.js`.
- **Clustering** — collapses dense subgraphs by directory/feature; toggleable.
- **Node sizing/coloring** — by metrics (incoming count, complexity, classification).
- **Selection + neighbourhood highlighting** — click a file, see direct dependents and dependencies.
- **Impact / blast-radius mode** (US-021) — BFS from a node showing transitive dependents.
- **Attack-surface overlay** (US-047) — sources red, sinks orange, both yellow, neutrals dimmed; animated source→sink paths.

---

## 3. Architectural Issue Detection

Deterministic, runs every index. Surfaced in the Issues tab.

| Issue type | What it flags | Heuristic |
|---|---|---|
| `circular_dependency` | Import cycles | DFS over `graph_edges` |
| `god_file` | Files doing too much | complexity > 30 OR 500+ lines + high incoming OR incoming > 30% of nodes |
| `high_coupling` | Files with too many neighbours | `outgoing_count > 15` |
| `dead_code` | Probably-unused files | Zero incoming edges + filename heuristics |
| `refactoring_candidate` | (group present in UI) | (see code) |

---

## 4. Security Suite

### 4.1 Secret Scanning (US-044)
- Regex rules in `secret-rules.json` (AWS, GitHub, OpenAI/Anthropic, Stripe, Google, Slack, JWTs, RSA/SSH private blocks).
- High-entropy catch-all on `*_key / *_secret / *_token / *_password` variables (Shannon > 4.5, ≥ 20 chars).
- Per-instance suppression via "Mark as false positive" → `issue_suppressions`.

### 4.2 SAST Pattern Scanning (US-046)
- AST-query rules per language (`backend/src/sast/rules/<lang>.json`).
- Targets: `eval()`, `dangerouslySetInnerHTML`, `child_process.exec` with template literals, `pickle.loads`, `subprocess(shell=True)`, weak crypto (MD5/SHA1/DES), SQL string concat, etc.
- Per-repo opt-out: `repositories.sast_disabled_rules TEXT[]` ("Disable this rule" in UI).

### 4.3 Dependency Vulnerability Scanning / SCA (US-045)
- Manifests: `package.json`, `package-lock.json`, `yarn.lock`, `requirements.txt`, `Pipfile.lock`, `go.mod`, `Cargo.lock`, `Gemfile.lock`, `*.csproj`.
- OSV.dev lookups, 24h cache.
- **Dependencies tab** in the UI — vulnerable packages, severities, fix versions.

### 4.4 Auth Coverage Check (US-049)
- Two-layer heuristic: in-file markers (`requireAuth`, `passport.authenticate`, `[Authorize]`, `@login_required`, `@UseGuards`, Devise/Sorcery patterns) + auth-related import paths.
- Public allow-list (`/health`, `/login`, `/.well-known/*`, etc.) avoids false positives.
- Suppressed via "Mark as intentionally public".

### 4.5 Attack-Surface Mapping (US-047)
- Pure-regex source/sink classifier per file → `graph_nodes.node_classification`.
- **Sources**: HTTP routes (Express/Flask/FastAPI/Spring/ASP.NET/actix/axum/Rails), CLI args, stdin.
- **Sinks**: SQL exec, shell/process exec, FS writes, deserialisation (pickle, yaml.load, ObjectInputStream), dynamic outbound HTTP.
- Client-side DFS finds source→sink reachability paths (capped 50 paths, depth 20).
- Drillable `AttackSurfacePanel` with per-source path counts.

### 4.6 AI Security Audit Mode (US-048)
- **Single-file audit** — OpenAI-driven, security-focused system prompt, 12 chunks re-ranked by security-keyword frequency, structured findings (`severity, category, line_reference, explanation, suggested_fix, confidence`).
- **Whole-repo audit** — top 20 files by `incoming_count + complexity_score`, sequential per-file with budget checks, persisted to `security_audits` table; supports `partial` status when budget runs out.
- Cross-links AI findings to deterministic `analysis_issues` rows on the same file.

---

## 5. AI Code Review (US-026)

- **Single-file review** via OpenAI (`gpt-4.1`).
- **Focus presets**: Performance, Bug Hunt, Architecture (the Security preset was replaced by Security Audit mode in US-048).
- **Modes**: General | Security Audit (segmented control).
- SSE streaming with abort on tab close.
- Counts against the per-user daily token budget.

---

## 6. AI Refactor Proposals (US-063 – US-066)

The "Propose fix" path on every issue card.

- **Generation** (US-064): one-click for any `analysis_issues` row. Per-issue-type structural context:
  - `god_file` → file + per-importer symbol breakdown (uses `graph_edges.symbols`)
  - `circular_dependency` → all cycle files + interconnecting edges
  - `high_coupling` → file + top-5 neighbours with symbol aggregation
  - `dead_code` → file + incoming-edge confirmation
  - `missing_auth` → route file + existing auth patterns
  - `hardcoded_secret` → ±10 lines around secret + `.env.example` if present
  - `vulnerable_dependency` → manifest + safe version proposal
- **Structured output**: `{ summary, rationale, changes: [{file_path, action, diff, full_content}], risks }`.
- **Streaming SSE**: `summary_delta`, `rationale_delta`, `change`, `risk`, `done`.
- **Caching** — most-recent pending proposal returned without re-calling the LLM; `?regenerate=true` bypasses.
- **Persistence** — `issue_proposals` table; stale-marked on re-index when underlying file's content_hash changes.
- **Review panel** (US-065) — slide-in panel with summary, rationale, per-file unified-diff renderer (added/removed/context coloring), risks list. Stale-banner with one-click regenerate. Token cost displayed.
- **Apply via PR** (US-066) — opens a GitHub draft PR in a single commit via the Git Data API (createBlob → createTree → createCommit → createRef → pulls.create). PR body embeds rationale, risks, and a deep link back to the CodeLens issue. Idempotent on retry. Per-issue "PR opened" badge on the IssueCard after success.

---

## 7. RAG-Powered Code Search

- **Embedding model**: OpenAI `text-embedding-3-small` (1536-dim), HNSW index `m=16 ef_construction=64` (US-041).
- **LLM**: OpenAI (`gpt-4.1`) for RAG response synthesis (same provider as review/audit).
- **Endpoints**: `/api/search/*`, dedicated Search page in the frontend.

---

## 8. File-Level Features

- **File chat** (`POST /api/file-chat/:repoId`) — AI conversation grounded in a single file.
- **File viewer** (US-037) — syntax-highlighted with line anchors; linked to from issues, paths, AI references.
- **File contents storage** (US-043) — `file_contents` table backs AI review retrieval; available to the agent epic when it ships.
- **Blast-radius / impact panel** — direct + transitive dependents for any file.
- **Per-file metrics** — line count, true cyclomatic complexity (US-040), incoming/outgoing counts.

---

## 9. Duplication Detection

- Cosine-similarity clustering over `code_chunks` embeddings → `duplicationScanner`.
- **Duplication section** in the Issues panel with severity, member count, total duplicated lines, similarity range.
- **DuplicationDetailModal** — side-by-side picker comparing any two cluster members.
- **AI shared-utility refactor** — OpenAI-driven extraction proposal (SSE-streamed) for a selected cluster.

---

## 10. Code Tours (US-060, US-061)

- **Generate** — AI-authored guided walkthroughs (`POST /:repoId/tours/generate`, behind `aiRateLimit`).
- **List / Update / Delete** — tours persist per user/repo.
- **Fork** (US-061) — branch off someone else's tour to create your own variant; `share-impact` endpoint reports downstream tours that would be affected by editing the source.

---

## 11. Teams (Shared Repos)

- **Create / list teams** (`/api/teams`).
- **Add repos to a team** so other team members can access them.
- **Access check** centralised in the `can_access_repo` Postgres RPC — checks ownership OR team membership.

---

## 12. Webhooks (Auto-Sync)

- **GitHub push webhook** (`POST /api/webhooks/github`) — runs before `express.json()` so the signature validator sees raw bytes.
- **`auto_sync_enabled`** column on `repositories` — re-indexes the repo on each push event.
- Per-repo webhook secret generated via `GET /api/repos/:repoId/webhook`.

---

## 13. Branch / Diff Viewing

- `GET /api/repos/:repoId/branches` — list branches.
- `GET /api/repos/:repoId/diff` — structural diff between two refs (`diffService` computes node/edge changes, not unified file diffs).

---

## 14. Churn Analysis

- `GET /api/repos/:repoId/churn` — per-file churn from git history. Surfaced in the metrics view alongside complexity.
- Used by the "what's been changing a lot" heuristic.

---

## 15. Usage & Budget (US-042)

- **Per-user daily token budget** (default 500k, env `MAX_DAILY_TOKENS_PER_USER`).
- **`api_usage_daily` rollup** — maintained by an `AFTER INSERT` trigger on `api_usage`; budget checks are O(1).
- `GET /api/usage/today` — exposes today's usage for the UI.
- `aiRateLimit` middleware returns 429 with a clear message when exhausted.

---

## 16. Observability & Performance

- **AsyncLocalStorage request ledger** (Phase 0) — every request records per-Supabase-call `(method, table, durationMs, status)`. Requests slower than `SLOW_REQUEST_MS` log a one-line summary with the top 3 DB calls.
- **Parser worker pool** (Phase 5.1) — Piscina-based, default `min(cpus, 8)` workers.
- **HNSW vector index** (US-041) — fast semantic search.
- **Embedding cache** — content-hash-keyed, shared across repos; trims OpenAI cost.
- **Supabase retry helper** — `withSupabaseRetry` for critical writes; bulk-select ceiling (`SAFE_FETCH_CEILING`) with truncation warnings.
- **Maintenance scripts**: monthly truncate of raw `api_usage`, quarterly eviction of stale `embedding_cache` rows.

---

## 17. Issue Suppressions

A unified suppression mechanism reusable by any rule-based scanner:
- `issue_suppressions` table — `(repo_id, file_path, rule_id, line_number, created_by, created_at)`.
- Per-rule actions in `IssuesPanel`:
  - Secrets → "Mark as false positive".
  - Missing auth → "Mark as intentionally public" (file-level, `line_number: 0`).
  - Insecure pattern → "Disable this rule" (writes to `repositories.sast_disabled_rules`).
- Suppressions persist across re-indexes.

---

## 18. Frontend Pages & Navigation

| Page | Purpose |
|---|---|
| Login | GitHub OAuth |
| AuthCallback | OAuth handshake |
| Dashboard | Repo list (own + team-shared) |
| RepoView | Tabs: Graph · Issues · Metrics · Dependencies · Tours · Review |
| Search | RAG-powered natural-language search |

---

## 19. Admin

- `routes/admin.js` — internal endpoints (not user-facing; reserved for ops).

---

## Tech Stack (TL;DR)

| Layer | Choice |
|---|---|
| Frontend | React 18 · Vite · Tailwind · D3.js v7 · React Router 6 |
| Backend | Node 20 · Express 4 · Octokit · openai · piscina |
| DB | Postgres 15 (Supabase) + pgvector (HNSW) |
| Auth | Supabase Auth + GitHub OAuth |
| AST | Tree-sitter (JS · TS · TSX · Python · C# · Go · Java · Rust · Ruby) |
| Models | OpenAI `text-embedding-3-small` (embeddings), `gpt-4.1` (RAG/review/audit/proposals/agent/tours), `gpt-4o-mini` (agent titles) |

---

## Currently Open / Planned Epics

From `issues.md`:

- **AI Repo Agent (US-067 – US-071)** — conversational agent over the deterministic analysis as a tool surface (`get_blast_radius`, `list_issues`, `find_paths`, `get_attack_paths`, `propose_fix`, etc.). Tool-use loop with OpenAI, SSE-streamed, persisted trace per turn. Replaces the current Search tab.

---

## What Recently Shipped (for context)

The most recent epic completed is **AI Refactor Proposals (US-063–US-066)**:
- DB schema + stale-detection
- Per-issue-type structural context generation
- Streaming review panel with diff renderer
- GitHub draft-PR creation in one commit via Git Data API
- Token-cost display, "PR opened" badges on IssueCards, applied-state banner with "View PR"

---

## Notable Gaps / Opportunities

Things that exist as primitives but aren't user-facing yet, or that overlap and could be unified:

- **Code tours + AI proposals** both produce structured AI artefacts but use unrelated UI patterns — could share a "review and apply" surface.
- **File chat** is per-file; the planned Repo Agent is whole-repo. There's no per-PR / per-diff chat today.
- **Webhooks** trigger re-indexing but don't yet notify users in-app when the index updates.
- **Teams** support sharing repos but not per-resource ACLs (e.g. a private security-audit shared with one teammate).
- **Branch/diff endpoint** computes structural diffs but doesn't yet feed into a "review this PR" workflow.
- **Tours** can be forked but there's no discovery / marketplace; tours are user-private today.
- **Dependency upgrades** are flagged via SCA but the "Propose fix" path for `vulnerable_dependency` doesn't yet auto-PR a `package.json` bump alongside lockfile re-generation.
- **Attack-surface paths** are visualised but no "fix this exposure" workflow exists.
- **No multi-repo / org-wide view** — every screen scopes to a single repo.
- **No metrics on AI quality** — proposals can be discarded but there's no aggregate "% applied" / "% discarded" telemetry.
- **No diff-aware review** — the AI code review is per-snippet, not per-PR; a PR-review epic would dovetail with the existing Octokit + Vault integration.
