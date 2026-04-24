# CodeLens — GitHub Issues / User Stories

Each story below is formatted as a GitHub Issue. Copy each one into GitHub Issues directly.

Assign labels: `epic/infra`, `epic/auth`, `epic/dashboard`, `epic/graph`, `epic/parsing`, `epic/ai`, `epic/search`, `epic/impact`, `epic/security`, `epic/analytics`

---

## 🏗️ EPIC: Infrastructure & Auth

---

### US-001: Supabase schema and database setup

**Labels:** `epic/infra` `database`
**Milestone:** Sprint 1 — Weeks 1–2

---

**As a** developer
**I want to** have the full database schema set up in Supabase from the start
**So that** all other features have a stable data layer to build against

**Acceptance Criteria**
- [ ] Supabase project created and credentials added to `.env`
- [ ] `profiles` table created and linked to `auth.users`
- [ ] `repositories` table created with all required fields
- [ ] `graph_nodes` table created for storing parsed file nodes
- [ ] `graph_edges` table created for storing dependency relationships
- [ ] `code_chunks` table created for RAG embeddings
- [ ] `analysis_issues` table created for architectural issue flags
- [ ] Row Level Security enabled on all tables
- [ ] All RLS policies enforce `auth.uid() = user_id`

**Note**
> Full schema:
> ```sql
> -- User profiles (extends Supabase auth.users)
> CREATE TABLE profiles (
>   id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
>   github_username     TEXT,
>   github_access_token TEXT, -- TODO: move to Supabase Vault before production
>   created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
> );
> ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
> CREATE POLICY "Users can only access their own profile"
>   ON profiles FOR ALL USING (auth.uid() = id);
>
> -- Repositories
> CREATE TYPE repo_status AS ENUM ('pending', 'indexing', 'ready', 'failed');
> CREATE TYPE repo_source AS ENUM ('github', 'upload');
>
> CREATE TABLE repositories (
>   id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
>   name           TEXT NOT NULL,
>   full_name      TEXT,
>   source         repo_source NOT NULL DEFAULT 'github',
>   status         repo_status NOT NULL DEFAULT 'pending',
>   github_url     TEXT,
>   default_branch TEXT DEFAULT 'main',
>   file_count     INT DEFAULT 0,
>   indexed_at     TIMESTAMPTZ,
>   created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
> );
> ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;
> CREATE POLICY "Users can only access their own repos"
>   ON repositories FOR ALL USING (auth.uid() = user_id);
>
> -- Graph nodes (one per file)
> CREATE TABLE graph_nodes (
>   id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   repo_id          UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
>   file_path        TEXT NOT NULL,
>   language         TEXT,
>   line_count       INT DEFAULT 0,
>   outgoing_count   INT DEFAULT 0,
>   incoming_count   INT DEFAULT 0,
>   complexity_score FLOAT DEFAULT 0,
>   UNIQUE (repo_id, file_path)
> );
> CREATE INDEX ON graph_nodes(repo_id);
>
> -- Graph edges (dependency relationships)
> CREATE TABLE graph_edges (
>   id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   repo_id   UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
>   from_path TEXT NOT NULL,
>   to_path   TEXT NOT NULL,
>   UNIQUE (repo_id, from_path, to_path)
> );
> CREATE INDEX ON graph_edges(repo_id);
> CREATE INDEX ON graph_edges(from_path);
> CREATE INDEX ON graph_edges(to_path);
>
> -- Code chunks for RAG
> CREATE EXTENSION IF NOT EXISTS vector;
> CREATE TABLE code_chunks (
>   id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   repo_id    UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
>   file_path  TEXT NOT NULL,
>   content    TEXT NOT NULL,
>   start_line INT,
>   end_line   INT,
>   embedding  vector(1536)
> );
> CREATE INDEX ON code_chunks USING ivfflat (embedding vector_cosine_ops);
>
> -- Architectural issues
> CREATE TYPE issue_type AS ENUM ('circular_dependency', 'god_file', 'dead_code', 'high_coupling');
>
> CREATE TABLE analysis_issues (
>   id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   repo_id     UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
>   type        issue_type NOT NULL,
>   severity    TEXT CHECK (severity IN ('low', 'medium', 'high')),
>   file_paths  TEXT[] NOT NULL,
>   description TEXT,
>   created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
> );
> CREATE INDEX ON analysis_issues(repo_id);
> ```
> Enable pgvector via the Supabase dashboard under Database → Extensions before running migrations.
> The `github_access_token` on `profiles` should eventually be stored in Supabase Vault — leave a `TODO` comment flagging it for now.

---

### US-002: Project and local environment setup

**Labels:** `epic/infra`
**Milestone:** Sprint 1 — Weeks 1–2

---

**As a** developer
**I want to** have a fully working local dev environment from day one
**So that** all three team members can run the project identically and there are no "works on my machine" issues

**Acceptance Criteria**
- [ ] Frontend initialised with Vite + React in `frontend/`
- [ ] Tailwind CSS configured and working in the frontend
- [ ] React Router installed and a basic route structure in place (`/login`, `/dashboard`, `/repo/:id`)
- [ ] Backend Express app running on `localhost:3001` with the existing route stubs wired up
- [ ] `npm run dev` works in both `frontend/` and `backend/` independently
- [ ] `docker-compose up` starts Postgres locally without errors
- [ ] `.env.example` is complete — all required keys documented
- [ ] A `scripts/setup.sh` helper script installs deps and copies `.env.example` → `.env` in one command
- [ ] `README.md` Getting Started section is accurate and a new team member can be running locally in under 10 minutes

**Note**
> Vite config: use `@vitejs/plugin-react`. Set `server.proxy` to forward `/api` requests to `localhost:3001` so the frontend doesn't need to think about CORS in dev.
> Tailwind: run `npx tailwindcss init -p` to generate `tailwind.config.js` and `postcss.config.js`. Set `content` to `['./index.html', './src/**/*.{js,jsx}']`.
> The `scripts/setup.sh` should be idempotent — safe to run more than once:
> ```bash
> #!/bin/bash
> cp -n .env.example .env
> cd backend && npm install
> cd ../frontend && npm install
> echo "Setup complete. Run 'docker-compose up -d' then start frontend and backend with 'npm run dev'."
> ```
> This story should be the very first thing completed in Sprint 1 — nothing else can be worked on in parallel until it's done.

---

### US-003: GitHub OAuth sign-in

**Labels:** `epic/auth`
**Milestone:** Sprint 1 — Weeks 1–2

---

**As a** developer
**I want to** sign in with my GitHub account
**So that** CodeLens can access my repositories and I have a persistent account

**Acceptance Criteria**
- [ ] Sign-in page exists at `/login`
- [ ] "Sign in with GitHub" button triggers Supabase GitHub OAuth flow
- [ ] On success, user is redirected to `/dashboard`
- [ ] On failure, an error message is shown on the login page
- [ ] If a user is already signed in and visits `/login`, they are redirected to `/dashboard`
- [ ] User's GitHub access token is stored on the `profiles` table after first sign-in
- [ ] Auth middleware protects all `/dashboard` and `/repo/*` routes — unauthenticated users are redirected to `/login`

**Note**
> Use Supabase Auth with the GitHub provider — configure the GitHub OAuth App in the Supabase dashboard.
> The callback URL must be registered in the GitHub OAuth App settings: `http://localhost:3001/auth/github/callback` for local dev.
> After the OAuth callback, store the `provider_token` (GitHub access token) from the Supabase session into `profiles.github_access_token` — this is needed for GitHub API calls in US-006.
> The login page should be minimal — CodeLens logo, a one-line tagline, and the GitHub sign-in button. Don't over-design it.

---

### US-004: Sign out

**Labels:** `epic/auth`
**Milestone:** Sprint 1 — Weeks 1–2

---

**As a** developer
**I want to** sign out of CodeLens
**So that** I can leave a shared machine or switch accounts

**Acceptance Criteria**
- [ ] A "Sign out" option exists in the navigation sidebar
- [ ] Clicking it calls Supabase `signOut()` and redirects to `/login`
- [ ] After sign-out, navigating to a protected route redirects back to `/login`
- [ ] No stale session data remains in the browser

**Note**
> Call `supabase.auth.signOut()` on the client, then redirect to `/login`.
> Clear any in-memory state (cached repo data, etc.) on sign-out.
> Place the sign-out button at the bottom of the sidebar next to the user avatar — a small labelled button or icon works well.

---

## 📊 EPIC: Dashboard

---

### US-005: Main dashboard page

**Labels:** `epic/dashboard`
**Milestone:** Sprint 1 — Weeks 1–2

---

**As a** developer
**I want to** see all my connected repositories in one place with their current status
**So that** I have a clear starting point every time I log in

**Acceptance Criteria**
- [ ] Dashboard page exists at `/dashboard`
- [ ] Shows a grid of all repositories the user has connected
- [ ] Each repo card shows: repo name, source (GitHub / upload), status badge, file count, and last indexed date
- [ ] Clicking a repo card navigates to `/repo/[id]`
- [ ] A "Connect Repository" button opens the repo connection flow (US-006)
- [ ] An "Upload Repository" button opens the upload flow (US-007)
- [ ] Status badges are colour-coded: pending → gray, indexing → blue (animated pulse), ready → green, failed → red
- [ ] Failed repos show a "Retry" button that re-triggers the indexing pipeline (US-008)
- [ ] Empty state shown when no repos are connected — with CTAs for both connection methods

**Note**
> Fetch all `repositories` for the current user ordered by `created_at DESC`.
> Poll for status updates every 5 seconds if any repo has status `pending` or `indexing` — stop polling once all are `ready` or `failed`.
> Empty state: "No repositories connected yet — connect a GitHub repo or upload a project to get started."
> 2-column grid on desktop, 1-column on mobile. Keep cards compact — this is a launcher, not a detail view.

---

### US-006: Connect a GitHub repository

**Labels:** `epic/dashboard` `epic/infra`
**Milestone:** Sprint 1 — Weeks 1–2

---

**As a** developer
**I want to** browse my GitHub repositories and connect one to CodeLens
**So that** it gets indexed and I can start exploring it

**Acceptance Criteria**
- [ ] A modal lets the user browse their GitHub repos
- [ ] Repos fetched live from the GitHub API using the user's stored access token
- [ ] List shows: repo name, visibility (public/private), primary language, and last updated date
- [ ] User can filter the list by typing a repo name
- [ ] Selecting a repo and clicking "Connect" creates a `repositories` record and triggers indexing asynchronously
- [ ] User is returned to `/dashboard` and sees the new repo card with `indexing` status
- [ ] Repos already connected shown as disabled with an "Already connected" label
- [ ] If the GitHub token is expired or missing, the user is prompted to re-authenticate

**Note**
> Use the Octokit SDK — call `GET /user/repos?sort=updated&per_page=100` to list repos.
> After selection, `POST /api/repos` creates the `repositories` record and fires the indexing pipeline asynchronously — return immediately with the new repo record, don't wait for indexing to complete.
> If the user has more than 100 repos, paginate — load more on scroll.
> The indexing pipeline accepts the GitHub access token and repo `full_name`, then fetches the file tree and file contents via the GitHub API.

---

### US-007: Upload a local repository

**Labels:** `epic/dashboard` `epic/infra`
**Milestone:** Sprint 1 — Weeks 1–2

---

**As a** developer
**I want to** upload a local project as a zip file
**So that** I can use CodeLens on codebases that are not on GitHub

**Acceptance Criteria**
- [ ] An upload modal accepts a `.zip` file via drag-and-drop or file picker
- [ ] File size limit of 50MB enforced — clear error shown if exceeded
- [ ] An upload progress bar is shown during the upload
- [ ] On completion, a `repositories` record is created with `source: 'upload'` and indexing is triggered
- [ ] User is returned to `/dashboard` and sees the new repo card with `indexing` status
- [ ] If the zip contains no supported files, the repo is marked `failed` with a descriptive error message

**Note**
> Send the zip as `multipart/form-data` to `POST /api/repos/upload`.
> The backend extracts the zip to a temp directory, reads the file tree, and kicks off the same indexing pipeline used for GitHub repos — the pipeline should be source-agnostic.
> Enforce the 50MB limit on both the frontend (before upload) and the backend (reject early with a 413 response).
> Supported extensions for parsing: `.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.cs`. Other files are stored but produce no graph edges.
> Clean up temp directories after indexing completes or fails.

---

### US-008: Repository re-index

**Labels:** `epic/dashboard` `epic/infra`
**Milestone:** Sprint 1 — Weeks 1–2

---

**As a** developer
**I want to** re-trigger indexing on a repository that has failed or become stale
**So that** I can recover from errors or refresh the analysis after pushing new code

**Acceptance Criteria**
- [ ] `POST /api/repos/:id/reindex` endpoint exists on the backend
- [ ] Endpoint resets `status` to `pending`, clears existing `graph_nodes`, `graph_edges`, `analysis_issues`, and `code_chunks` for the repo, then re-runs the full indexing pipeline
- [ ] The "Retry" button on failed repo cards calls this endpoint
- [ ] A "Re-index" option is also available from the repo analysis page header (for `ready` repos)
- [ ] While re-indexing, the repo card shows `indexing` status and the analysis page shows a progress state
- [ ] Route is authenticated and verifies the repo belongs to the requesting user

**Note**
> Delete order matters due to foreign keys: delete `code_chunks`, `analysis_issues`, `graph_edges`, `graph_nodes` — then reset `repositories.status = 'pending'` before firing the pipeline.
> Use `DELETE FROM graph_nodes WHERE repo_id = $1` etc. — don't drop and recreate the rows, just clear them.
> The re-index pipeline is identical to the initial index pipeline — call the same `indexRepository()` service function.
> On the frontend, after calling the reindex endpoint, start polling for status updates (same logic as US-005).

---

## ⚙️ EPIC: Parsing Engine

---

### US-009: Tree-sitter parsing service — JavaScript & TypeScript

**Labels:** `epic/parsing`
**Milestone:** Sprint 2 — Weeks 3–4

---

**As a** developer
**I want** the backend to parse JS and TS files using Tree-sitter and extract their imports
**So that** the dependency graph accurately reflects how JavaScript and TypeScript files relate

**Acceptance Criteria**
- [ ] Parser handles `.js`, `.jsx`, `.ts`, `.tsx` files
- [ ] ES module `import` statements extracted (`import x from './y'`)
- [ ] CommonJS `require()` calls extracted (`const x = require('./y')`)
- [ ] Dynamic imports extracted (`import('./y')`)
- [ ] Re-exports extracted (`export { x } from './y'`)
- [ ] Raw import paths resolved to actual repo-relative file paths
- [ ] External/node_modules imports excluded from graph edges
- [ ] Parser returns `{ filePath, imports: string[], exports: string[] }`
- [ ] Files that fail to parse are skipped with a warning log — pipeline continues

**Note**
> Use `tree-sitter` + `tree-sitter-javascript` for `.js`/`.jsx` and `tree-sitter-typescript` for `.ts`/`.tsx`.
> Import path resolution:
> 1. If the path starts with `./` or `../`, resolve relative to the current file's directory
> 2. Try appending `.js`, `.ts`, `.jsx`, `.tsx` — check against the repo's file list
> 3. Try resolving as an index file: `./utils` → `./utils/index.ts`
> 4. If nothing resolves, treat as external and skip (no graph edge created)
> Paths with no leading `./` or `../` (e.g. `import React from 'react'`) are always external — skip them.
> Wrap each file parse in try/catch — log the error with the file path and continue.

---

### US-010: Tree-sitter parsing service — Python

**Labels:** `epic/parsing`
**Milestone:** Sprint 2 — Weeks 3–4

---

**As a** developer
**I want** the backend to parse Python files and extract their imports
**So that** Python repositories can be fully indexed and analysed

**Acceptance Criteria**
- [ ] Parser handles `.py` files
- [ ] `import module` statements extracted
- [ ] `from module import name` statements extracted
- [ ] Relative imports resolved (`from . import x`, `from ..utils import y`)
- [ ] Absolute imports that map to files within the repo resolved — third-party imports excluded
- [ ] Parser returns `{ filePath, imports: string[], exports: [] }`
- [ ] Files that fail to parse are skipped gracefully

**Note**
> Use `tree-sitter` + `tree-sitter-python`.
> Resolving Python module paths to file paths: replace `.` with `/` and append `.py`. E.g. `from utils.helpers import x` → look for `utils/helpers.py` in the file list.
> Relative imports: `from . import x` → resolve relative to the current file's directory. `from .. import y` → go up one directory level.
> If a module path resolves to a directory, check for `__init__.py` inside it and use that as the edge target.
> If an import doesn't resolve to any file in the repo, treat it as third-party and skip.

---

### US-011: Tree-sitter parsing service — C#

**Labels:** `epic/parsing`
**Milestone:** Sprint 2 — Weeks 3–4

---

**As a** developer
**I want** the backend to parse C# files and extract their namespace references
**So that** .NET repositories can be indexed and analysed

**Acceptance Criteria**
- [ ] Parser handles `.cs` files
- [ ] `using` directives extracted per file
- [ ] Namespace declarations extracted per file
- [ ] `using` directives that match namespaces defined within the repo resolved to file paths
- [ ] `System.*`, `Microsoft.*`, and NuGet package imports excluded
- [ ] Parser returns `{ filePath, imports: string[], exports: string[] }`
- [ ] Files that fail to parse are skipped gracefully

**Note**
> Use `tree-sitter` + `tree-sitter-c-sharp`.
> Resolution strategy: before parsing imports, do a first pass over all `.cs` files to build a `namespace → [filePaths]` map. Then for each `using` directive, look it up in that map.
> Partial namespaces are common — `using MyApp.Services` might map to multiple files in the `Services/` directory. Create an edge to each.
> Best-effort implementation is acceptable for Sprint 2 — add a `// TODO: improve namespace resolution accuracy` comment and revisit in Sprint 5.

---

### US-012: Dependency graph builder and storage

**Labels:** `epic/parsing` `database`
**Milestone:** Sprint 2 — Weeks 3–4

---

**As a** developer
**I want** the system to take all parsed file data and store a complete dependency graph in Supabase
**So that** the graph is ready to be queried and visualised by the frontend

**Acceptance Criteria**
- [ ] After all files are parsed, nodes and edges are bulk-inserted into Supabase
- [ ] Duplicate edges handled with upsert — no errors on re-runs
- [ ] `repositories.file_count` updated after indexing
- [ ] `repositories.indexed_at` set on successful completion
- [ ] `repositories.status` set to `ready` on success, `failed` on any unrecovered error
- [ ] Node `outgoing_count`, `incoming_count`, and `complexity_score` computed and stored
- [ ] Architectural issue detection runs at the end of this step
- [ ] Whole pipeline wrapped in try/catch — any failure sets status to `failed` and logs the error

**Note**
> Full pipeline order:
> 1. Fetch all files from GitHub API or extracted zip
> 2. Filter to supported extensions (`.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.cs`)
> 3. Parse each file using the appropriate language parser — run with `Promise.all` + concurrency limit of 10
> 4. Resolve import paths to repo-relative file paths
> 5. Deduplicate nodes (by `file_path`) and edges (by `from_path + to_path`)
> 6. Bulk insert nodes in batches of 500, then edges in batches of 500
> 7. Compute and update `outgoing_count`, `incoming_count`, `complexity_score` on each node
> 8. Run issue detection — insert results into `analysis_issues`
> 9. Set `repositories.status = 'ready'`, update `file_count` and `indexed_at`
> Use `ON CONFLICT DO NOTHING` for node and edge inserts to handle re-indexing cleanly.

---

## 📈 EPIC: Repository Analysis View

---

### US-013: Repository analysis page layout

**Labels:** `epic/graph`
**Milestone:** Sprint 3 — Weeks 5–6

---

**As a** developer
**I want to** have a clear, navigable layout for a repository's full analysis
**So that** I can move between the graph, metrics, issues, and search without losing context

**Acceptance Criteria**
- [ ] Repo analysis page exists at `/repo/[id]`
- [ ] Page has a tab bar with four tabs: "Graph", "Metrics", "Issues", "Search"
- [ ] Active tab is highlighted and the correct panel is rendered
- [ ] Repo name and status badge shown in the page header
- [ ] A "← Dashboard" back link in the header
- [ ] If status is `indexing`, show an animated progress state instead of the tabs
- [ ] If status is `failed`, show an error message with a Retry button instead of the tabs
- [ ] The "Issues" tab label shows a count badge when issues exist (e.g. "Issues (7)")

**Note**
> Fetch the `repositories` record, all `graph_nodes`, `graph_edges`, and `analysis_issues` on page load — pass them down as props so all four panels share the same data without re-fetching independently.
> If status is `indexing`, poll every 5 seconds until it changes to `ready` or `failed`.
> Tab switching should be instant — mount all panels on load and show/hide the active one via CSS (`display: none`), not unmount/remount. This preserves D3 simulation state when the user switches away from the graph and back.

---

### US-014: Interactive dependency graph (D3)

**Labels:** `epic/graph`
**Milestone:** Sprint 3 — Weeks 5–6

---

**As a** developer
**I want to** see a visual, interactive graph of my repository's file dependencies
**So that** I can understand the architecture at a glance and trace how files connect

**Acceptance Criteria**
- [ ] Graph renders all files as nodes and dependencies as directed edges with arrowheads
- [ ] Node size scales with `incoming_count` (more dependents = larger node)
- [ ] Node colour indicates language: JS/TS → blue, Python → yellow, C# → purple, unknown → gray
- [ ] Nodes flagged as issues are outlined in red
- [ ] User can zoom in/out via scroll wheel and pan by click-dragging the canvas
- [ ] Clicking a node highlights its direct imports (outgoing) and dependents (incoming) — all other nodes and edges dim
- [ ] Clicking a node shows a details panel (slide-in from the right): file path, language, line count, complexity score, import count, dependent count
- [ ] Double-clicking a node copies its file path to the clipboard with a brief toast confirmation
- [ ] A "Reset view" button recentres the graph and resets zoom
- [ ] Graph renders acceptably for repos up to 500 nodes

**Note**
> Use D3 force-directed graph (`d3-force`) with `forceLink`, `forceManyBody`, `forceCenter`, and `forceCollide` to prevent overlap.
> Keep all D3 DOM manipulation isolated in a `useGraphSimulation` hook — never mix D3 with React state updates.
> For repos with 300+ nodes, switch from SVG to Canvas rendering for performance.
> Run the force simulation for 300 ticks before first render to avoid the chaotic explosion on load.
> Node click: store `selectedNodeId` in React state. Apply `opacity: 0.15` to unrelated nodes and edges via CSS class. Render the details slide-in panel.
> The details panel should be a `w-72` slide-in from the right — not a modal, it would obscure the graph.

---

### US-015: File metrics table

**Labels:** `epic/graph`
**Milestone:** Sprint 3 — Weeks 5–6

---

**As a** developer
**I want to** see all files listed with their dependency and complexity metrics in a sortable table
**So that** I can quickly identify critical or risky files without navigating the graph manually

**Acceptance Criteria**
- [ ] Metrics table shown on the "Metrics" tab
- [ ] Columns: File Path, Language, Lines, Imports (outgoing), Dependents (incoming), Complexity Score
- [ ] Every column sortable ascending/descending by clicking the header
- [ ] A search input filters rows by file path in real time
- [ ] Risk highlighting: high complexity AND high dependents → red row; high in only one metric → amber row
- [ ] Clicking a row switches to the "Graph" tab and selects that node (pans and highlights it)
- [ ] A summary line above the table: "X files total · Y critical · Z at-risk"

**Note**
> "Critical" and "at-risk" thresholds should be relative to the repo — use the 90th percentile of the repo's own distribution for both complexity and incoming_count. Never use hardcoded numbers.
> The `outgoing_count` and `incoming_count` values are already stored on `graph_nodes` from the indexing step — no extra computation needed at render time.
> Clicking a row: update shared `selectedNodeId` state (lifted to the repo page), switch to the "Graph" tab, auto-pan the graph and highlight the selected node.
> Complexity score formula for Sprint 3: `line_count × (outgoing_count / total_nodes_in_repo)`. Mark with `// TODO: replace with cyclomatic complexity in Sprint 9`.

---

### US-016: Architectural issues panel

**Labels:** `epic/graph`
**Milestone:** Sprint 3 — Weeks 5–6

---

**As a** developer
**I want to** see a list of automatically detected structural problems in my codebase
**So that** I can understand what's risky and prioritise what to fix

**Acceptance Criteria**
- [ ] Issues panel shown on the "Issues" tab
- [ ] Issues grouped by type: Circular Dependencies, God Files, High Coupling, Dead Code
- [ ] Each issue shows: severity badge (low / medium / high), affected file path(s), and a plain-English description
- [ ] Severity badge colours: low → yellow, medium → orange, high → red
- [ ] Clicking an issue switches to the "Graph" tab and highlights the affected node(s)
- [ ] Zero-issues state: "No issues detected — your codebase looks healthy 🎉"
- [ ] Issue count badge shown on the "Issues" tab label

**Note**
> Issue detection logic (runs at end of indexing pipeline — results stored in `analysis_issues`):
>
> **Circular dependency:** DFS on the graph — any back-edge = cycle. Store all file paths in the cycle. Severity: always high.
>
> **God file:** `incoming_count > (total_nodes × 0.3)` OR `line_count > 500` with high incoming_count. Severity: medium if one condition, high if both. Description: "This file is imported by X% of the codebase — changes here have an extremely wide blast radius."
>
> **High coupling:** `outgoing_count > 15`. Severity: low (15–20), medium (20–30), high (30+). Description: "This file imports X other files — it may be doing too much and is difficult to test or refactor."
>
> **Dead code:** `incoming_count === 0` AND not a known entry point (`index.js`, `main.py`, `Program.cs`, `app.js`, `server.js`). Severity: always low. Description: "No other files import this file — it may be unused."

---

## 🤖 EPIC: AI Search

---

### US-017: Code chunk indexing and embedding generation

**Labels:** `epic/ai`
**Milestone:** Sprint 4 — Weeks 7–8

---

**As a** developer
**I want** the codebase to be split into semantic chunks and embedded during indexing
**So that** natural language search can retrieve the most relevant code for any query

**Acceptance Criteria**
- [ ] Each file split into logical chunks during indexing
- [ ] Chunks do not exceed 512 tokens
- [ ] Each chunk stores: `repo_id`, `file_path`, `start_line`, `end_line`, `content`, `embedding`
- [ ] Embeddings generated and stored in the `code_chunks.embedding` column
- [ ] Re-indexing a repo deletes existing chunks and regenerates them
- [ ] Files that fail to embed are skipped with a warning — they do not block other files
- [ ] Embedding step runs after the graph is fully built so the graph is available even if embedding fails

**Note**
> Chunking strategy: split at logical AST boundaries. For JS/TS, chunk at function/class level. For Python, at function/class/module level. For C#, at method/class level. Min chunk size: 5 lines. Max: ~50 lines.
> If a file is under 50 lines, treat the whole file as one chunk.
> Use batched embedding API calls — embed 20 chunks per request to stay within rate limits.
> The embedding dimension must match the `vector(N)` column in the schema — pick one model and be consistent.
> Delete existing chunks before re-indexing: `DELETE FROM code_chunks WHERE repo_id = $1`.

---

### US-018: Natural language search panel

**Labels:** `epic/search`
**Milestone:** Sprint 4 — Weeks 7–8

---

**As a** developer
**I want to** type a plain English question about my codebase and get a clear, referenced answer
**So that** I can understand how things work without manually hunting through files

**Acceptance Criteria**
- [ ] Search panel shown on the "Search" tab
- [ ] Text input with placeholder: "How does authentication work?"
- [ ] Submitting a query shows a streaming state while the RAG pipeline runs
- [ ] Answer displayed with syntax-highlighted code snippets where relevant
- [ ] A "Sources" section lists up to 5 referenced files with path, line range, and a short excerpt
- [ ] Clicking a source file path copies it to the clipboard
- [ ] Prior queries in the session shown as a history list below the input — clicking one re-runs it
- [ ] Pre-query empty state shows 4 example questions the user can click to try

**Note**
> Call `POST /api/repos/:id/search` with `{ query: string }` — see US-019 for the API.
> Stream the Claude response using the Anthropic streaming API — show the answer appearing in real time.
> Example questions for the empty state:
> - "How does authentication work?"
> - "Where is the database connection configured?"
> - "What happens when a new user registers?"
> - "Which files handle error logging?"
> Session history: React state only — no persistence between page loads at this stage.
> Source excerpts: show the first 2 lines of the chunk. Clicking "Expand" shows the full chunk in a code block.

---

### US-019: Search API route (RAG pipeline)

**Labels:** `epic/ai` `epic/search`
**Milestone:** Sprint 4 — Weeks 7–8

---

**As a** developer
**I want** the backend to handle a natural language query using RAG and return a grounded, cited answer
**So that** the search feature returns accurate, codebase-specific explanations — not hallucinations

**Acceptance Criteria**
- [ ] API route exists at `POST /api/repos/:repoId/search`
- [ ] Accepts `{ query: string }` in the request body
- [ ] Query embedded and used to retrieve top 8 most similar `code_chunks` via cosine similarity
- [ ] Retrieved chunks passed to Claude as context with a strict system prompt
- [ ] Response includes: streamed `answer`, `sources` array of `{ file_path, start_line, end_line, excerpt }`
- [ ] Route is authenticated — returns 401 if no session
- [ ] Route verifies the repo belongs to the requesting user — returns 404 otherwise
- [ ] If no relevant chunks found, returns a graceful fallback — no hallucination

**Note**
> RAG pipeline:
> 1. Embed the query using the same model used at indexing time
> 2. Vector similarity search: `SELECT * FROM code_chunks WHERE repo_id = $1 ORDER BY embedding <=> $2 LIMIT 8`
> 3. If the best match has cosine distance > 0.4, skip the Claude call and return: "I couldn't find relevant code for that question in this repository."
> 4. Build the Claude prompt:
>    - System: "You are a code assistant. Answer the user's question using ONLY the code excerpts provided below. Always reference the file path and line numbers when you cite code. If the answer is not in the provided excerpts, say so clearly — do not guess."
>    - User: `Question: {query}\n\nCode context:\n{chunks formatted as:\n--- {file_path} (lines {start_line}–{end_line}) ---\n{content}\n}`
> 5. Stream the Claude response back to the client
> Use `claude-sonnet-4-20250514`.
> Return all 8 retrieved chunks as `sources` regardless of which ones Claude explicitly cited — the frontend shows up to 5.

---

### US-026: AI Code Review Panel

**Labels:** `epic/ai` `epic/search`
**Milestone:** Sprint 6 — Weeks 11–12

---

**As a** developer
**I want to** paste a code snippet and get an AI review that considers my actual codebase
**So that** I know whether the code is well-written and whether it integrates cleanly with what already exists

**Acceptance Criteria**
- [ ] Code Review panel accessible from the repo sidebar nav
- [ ] Textarea for pasting a code snippet (up to ~200 lines)
- [ ] Optional context field: "What is this code supposed to do?"
- [ ] On submit, sends the snippet + top 5 semantically similar chunks from the indexed codebase to Claude
- [ ] Claude responds with: a quality assessment, specific improvement suggestions, and a compatibility note ("This pattern matches how auth is handled in src/middleware/auth.js" or "This introduces a new pattern that conflicts with...")
- [ ] Response streams in like the Search panel
- [ ] A "Clean up this code" quick action that asks Claude to rewrite the snippet following patterns it found in the repo

**Note**
> Reuse the SSE streaming infrastructure from `searchController.js`. The system prompt should be: "You are reviewing a code snippet for a developer. You have context from their existing codebase below. Assess code quality, suggest improvements, and specifically note whether this code is consistent with the patterns and conventions you see in their codebase."

---

## 💥 EPIC: Change Impact Analysis

---

### US-020: File selection for impact analysis

**Labels:** `epic/impact`
**Milestone:** Sprint 4 — Weeks 7–8

---

**As a** developer
**I want to** select a file in the graph and trigger a blast radius analysis
**So that** I can understand the scope of a change before I make it

**Acceptance Criteria**
- [ ] Right-clicking a node on the graph opens a context menu
- [ ] Context menu options: "View details", "Analyse impact", "Copy path"
- [ ] Clicking "Analyse impact" triggers blast radius computation for that file
- [ ] A file can also be selected from the Metrics table and impact triggered from the details panel
- [ ] Only one impact analysis active at a time — triggering a new one replaces the previous
- [ ] A visible "Impact Analysis active" banner shown while an analysis is active

**Note**
> Context menu: render as a floating `div` positioned at the cursor coordinates from the click event (`e.clientX`, `e.clientY`). Dismiss on any outside click.
> Keep it simple — three options is plenty. No libraries needed for this.
> Impact analysis is computed entirely client-side from already-loaded graph data — no extra API call needed. See US-021.

---

### US-021: Blast radius visualisation

**Labels:** `epic/impact`
**Milestone:** Sprint 4 — Weeks 7–8

---

**As a** developer
**I want to** see the blast radius of a file change visualised on the dependency graph
**So that** I can immediately understand which parts of the codebase would be affected

**Acceptance Criteria**
- [ ] The selected file highlighted in red on the graph
- [ ] All directly and transitively dependent files highlighted in orange
- [ ] All unaffected nodes dimmed to low opacity
- [ ] Side panel shows: selected file name, direct impact count, transitive impact count, list of directly affected files, collapsible list of transitively affected files
- [ ] A "Copy impact list" button copies all affected paths to the clipboard
- [ ] An "Export as JSON" button downloads `{ source: string, direct: string[], transitive: string[] }` as a `.json` file
- [ ] A "Clear" button resets the graph to its default state
- [ ] If the selected file has zero dependents: "No files depend on this file — changes here are isolated."

**Note**
> Blast radius computation (client-side BFS — no API call):
> 1. Build a reverse adjacency map from `graph_edges`: `Map<filePath, Set<dependents>>`
> 2. BFS from the selected file using the reverse map
> 3. Depth 1 = "direct" impact, depth 2+ = "transitive" impact
> For blast radii > 100 files, collapse the transitive list and show "...and X more" with an expand button.
> The side panel replaces the node details panel — slide in from the right with a clear "Impact Analysis: {filename}" header.
> The JSON export is a simple `JSON.stringify` + blob download — no backend call needed.

---

## ✨ EPIC: Polish & Stabilisation

---

### US-022: Global app shell and navigation

**Labels:** `epic/dashboard`
**Milestone:** Sprint 5 — Weeks 9–10

---

**As a** developer
**I want** a consistent layout and navigation across all pages
**So that** moving between repos and features feels seamless

**Acceptance Criteria**
- [ ] Persistent left sidebar on all authenticated pages: CodeLens logo (links to `/dashboard`), Dashboard link, user avatar + GitHub username at the bottom
- [ ] On repo pages, the sidebar shows the current repo name and a back link
- [ ] Active route highlighted in the sidebar
- [ ] Sidebar collapses to icon-only on screens narrower than `lg`
- [ ] Repo pages have a top tab bar: "Graph", "Metrics", "Issues", "Search"
- [ ] All pages use consistent spacing, typography, and colour palette

**Note**
> Build a shared `AppLayout` component wrapping all authenticated pages — takes `children` and optionally a `repo` prop for repo-context pages.
> Tailwind: `w-64` fixed sidebar + `flex-1` main area is a solid baseline.
> User avatar: use the GitHub avatar URL from the Supabase auth session. Render initials as fallback if the image fails to load.
> Logo links to `/dashboard` from any route.

---

### US-023: Empty states and error states

**Labels:** `epic/dashboard`
**Milestone:** Sprint 5 — Weeks 9–10

---

**As a** developer
**I want** every view to have a proper empty state and error state
**So that** the app always feels finished and never shows a blank or broken screen

**Acceptance Criteria**
- [ ] Dashboard: empty state with CTAs to connect or upload a repo
- [ ] Graph: clear message if repo has no parseable files
- [ ] Issues tab: positive zero-state ("Your codebase looks healthy 🎉")
- [ ] Search tab: pre-query state with example questions
- [ ] Search: no-results state with a helpful message (not "No data")
- [ ] All API errors show a non-blocking toast (bottom-right, auto-dismiss after 5 seconds)
- [ ] All loading states use skeleton loaders — no raw spinners

**Note**
> Build a shared `EmptyState` component: props `icon`, `title`, `description`, optional `action: { label, onClick }`.
> Build a shared `ErrorToast` component — mount a single instance at the app root and trigger it via context or event emitter.
> Skeleton patterns: graph → gray rectangle the size of the canvas; metrics → 8 skeleton table rows; issues → 3 skeleton issue cards.
> Never surface raw API error messages to the user. Map to human-readable strings — e.g. 401 → "Your session has expired — please sign in again."

---

### US-024: Onboarding modal for first-time users

**Labels:** `epic/dashboard`
**Milestone:** Sprint 5 — Weeks 9–10

---

**As a** first-time user
**I want** a brief guided introduction when I first sign in
**So that** I understand what CodeLens does and how to get started without reading docs

**Acceptance Criteria**
- [ ] On first sign-in, a modal overlay appears before the dashboard
- [ ] Onboarding has 4 steps: Welcome → Connect a repo → Explore the graph → Ask questions
- [ ] Each step has a title, a 2–3 sentence description, and a simple illustration
- [ ] Forward/back navigation between steps
- [ ] "Skip" button dismisses the modal at any step
- [ ] "Get started" on the final step closes the modal and lands on the dashboard
- [ ] Completion/dismissal stored in `localStorage` — onboarding never shown again after
- [ ] A "Show introduction again" link exists in the sidebar footer

**Note**
> Track with `localStorage` key `codelens_onboarding_complete`. Check on dashboard mount — if absent, show the modal.
> Suggested copy:
> - Step 1: "Welcome to CodeLens — understand any codebase in minutes, not days."
> - Step 2: "Connect a GitHub repo or upload a project — we'll index it and map how everything connects."
> - Step 3: "Explore the dependency graph — see which files are critical, risky, or unused at a glance."
> - Step 4: "Ask anything — natural language search tells you how features work without digging through files."
> No third-party onboarding libraries — a simple stepped modal is fast to build and fully in your control.

---

### US-025: Performance optimisation for large repositories

**Labels:** `epic/graph`
**Milestone:** Sprint 5 — Weeks 9–10

---

**As a** developer
**I want** CodeLens to handle large real-world repositories without slowdowns or crashes
**So that** the tool is genuinely useful on real codebases, not just demos

**Acceptance Criteria**
- [ ] Dependency graph is interactive within 2 seconds for repos with 500+ nodes
- [ ] Metrics table handles 1000+ rows without jank (virtual scrolling implemented)
- [ ] Indexing pipeline completes within 5 minutes for a 1000-file repo
- [ ] RAG search returns results within 10 seconds for any query
- [ ] App does not crash or memory-leak on large repos

**Note**
> Graph: if node count > 300, switch to Canvas rendering. Also consider directory-level clustering — group files in the same directory into expandable cluster nodes. This dramatically reduces visual noise on large repos.
> Metrics table: implement a simple virtual scrolling window — only render rows in the viewport + a 20-row buffer above and below.
> Indexing: verify `Promise.all` with a concurrency limit of 10 is correctly in place from US-012.
> Test repos to benchmark against: `expressjs/express` (~200 files), `pallets/flask` (~300 files), and one large TypeScript repo (e.g. `microsoft/TypeScript` or `vercel/next.js`).

---

US-026: AI Code Review Panel

**As a** developer
**I want to** paste a code snippet and get an AI review that considers my actual codebase
**So that** I know whether the code is well-written and whether it integrates cleanly with what already exists

**Acceptance Criteria**
- [ ] Code Review panel accessible from the repo sidebar nav
- [ ] Textarea for pasting a code snippet (up to ~200 lines)
- [ ] Optional context field: "What is this code supposed to do?"
- [ ] On submit, sends the snippet + top 5 semantically similar chunks from the indexed codebase to Claude
- [ ] Claude responds with: a quality assessment, specific improvement suggestions, and a compatibility note ("This pattern matches how auth is handled in src/middleware/auth.js" or "This introduces a new pattern that conflicts with...")
- [ ] Response streams in like the Search panel
- [ ] A "Clean up this code" quick action that asks Claude to rewrite the snippet following patterns it found in the repo

**Note**
> Reuse the SSE streaming infrastructure from `searchController.js`. The system prompt should be: "You are reviewing a code snippet for a developer. You have context from their existing codebase below. Assess code quality, suggest improvements, and specifically note whether this code is consistent with the patterns and conventions you see in their codebase."

### US-027: Context-aware sidebar navigation

**Labels:** `epic/dashboard`
**Milestone:** Sprint 5 — Weeks 9–10

---

**As a** developer navigating a repository
**I want** the sidebar to reflect where I am in the app
**So that** navigation feels natural and the sidebar earns its space

**Acceptance Criteria**
- [ ] On the Dashboard, sidebar shows: Dashboard link (as now)
- [ ] When inside `/repo/:repoId`, sidebar shows: a "← Repositories" back link, the repo name (truncated with tooltip), then nav items: Graph, Metrics, Issues, Search, Code Review
- [ ] Active sidebar item highlighted with the same indigo indicator as the current tab system
- [ ] The horizontal tab bar on the repo page is removed — sidebar takes over that role
- [ ] Status badge (Ready / Indexing / Failed) shown next to the repo name in sidebar
- [ ] Issue count badge shown on the Issues sidebar item

**Note**
> Lift the tab state up to a URL param (`/repo/:repoId?tab=graph`) so the sidebar links work correctly with browser back/forward. The `Layout.jsx` component needs a repo prop passed from `RepoView` — or use a context. Either works.

---

### US-028: GitHub Webhooks for auto-sync

**Labels:** `epic/infra`
**Milestone:** Sprint 6 — Weeks 11–12

---

**As a** developer
**I want** CodeLens to listen for pushes to my connected GitHub repositories
**So that** my dependency graph and AI search index are always up-to-date automatically

**Acceptance Criteria**
- [ ] Provide a "Generate Webhook URL" button in repo settings
- [ ] Endpoint `/api/webhooks/github` accepts GitHub push events
- [ ] Validates payload signature using a webhook secret
- [ ] Automatically triggers the re-index pipeline (`US-008`) for that repository
- [ ] "Auto-sync" toggle added to repo cards to easily enable/disable webhook indexing

**Note**
> GitHub webhooks need a secret to verify the `x-hub-signature-256`. Store the secret securely in the `repositories` table. Only trigger index on pushes to the `default_branch` to avoid unnecessary processing on feature branches.

---

## 🚀 EPIC: Production & Deployment

---

### US-029: Production Dockerisation

**Labels:** `epic/infra` `devops`
**Milestone:** Sprint 7 — Weeks 13–14

---

**As a** DevOps engineer / developer
**I want** production-ready Dockerfiles for the frontend and backend
**So that** the application can be deployed consistently and securely anywhere containerised hosting is supported

**Acceptance Criteria**
- [ ] Backend `Dockerfile` uses a multi-stage build, ignoring `devDependencies`
- [ ] Frontend `Dockerfile` builds the Vite app and serves the static output via Nginx
- [ ] A `docker-compose.prod.yml` template created for full-stack deployment without hot-reloading overhead
- [ ] Docker images enforce running as a non-root unprivileged user for security
- [ ] All sensitive credentials (Supabase keys, GitHub secrets) are passed strictly as environment variables

**Note**
> The backend container only needs Node.js. The frontend needs Node.js for the build stage, but should use a lightweight Nginx alpine image for serving the built `/dist` folder.

---

### US-030: CI/CD Pipeline (GitHub Actions)

**Labels:** `epic/infra` `devops`
**Milestone:** Sprint 7 — Weeks 13–14

---

**As a** developer
**I want** a GitHub Actions pipeline that runs on every push and pull request
**So that** broken code is blocked from being merged and successful builds are automatically deployed

**Acceptance Criteria**
- [ ] GitHub Actions workflow `.github/workflows/ci.yml` established
- [ ] Pipeline runs `npm run lint` and any automated tests for both frontend and backend
- [ ] Code cannot be merged into `main` if the pipeline fails
- [ ] A continuous deployment pipeline `cd.yml` is triggered upon merges to `main`
- [ ] Deployment steps push the latest Docker images to a registry (e.g. GitHub Container Registry or Docker Hub)

**Note**
> Use standard Node.js setup actions with caching for `node_modules` to keep build times low.
> **Prerequisite:** US-035 (Automated Test Suite) must be completed first. Without it, the pipeline only runs lint.

---

### US-031: Cloud Infrastructure & Hosting Setup

**Labels:** `epic/infra` `devops`
**Milestone:** Sprint 7 — Weeks 13–14

---

**As a** stakeholder
**I want** the CodeLens application to be hosted publicly on the web
**So that** users don't have to clone the repository to use the tool

**Acceptance Criteria**
- [ ] Production frontend deployed (e.g., to Vercel, Netlify, or via Docker on AWS/DigitalOcean)
- [ ] Production backend deployed and publicly accessible via HTTPS
- [ ] A separate production Supabase instance is configured with production secrets
- [ ] Custom domain successfully routed to the frontend
- [ ] GitHub OAuth App updated/created with the production callback URL

**Note**
> Ensure CORS is correctly configured on the backend to *only* accept requests from the deployed frontend domain. Protect all API endpoints.

---

## 🌟 EPIC: Advanced Integrations & Teams

---

### US-032: Architecture Graph Export (PNG/SVG)

**Labels:** `epic/graph`
**Milestone:** Sprint 6 — Weeks 11–12

---

**As a** developer
**I want** to export the visual architecture graph as an image
**So that** I can easily embed it in my documentation, READMEs, or share it in presentations

**Acceptance Criteria**
- [ ] An "Export Image" button added to the Graph view panel
- [ ] Supports exporting the current view as both a high-resolution PNG and a scalable SVG
- [ ] The export inherits the current graph state (highlights, zoomed positions, and labels)
- [ ] Visual artifacts like UI panels or floating buttons are excluded from the exported image

**Note**
> If using D3 with an SVG element, you can serialize the SVG to a blob for download. If using a Canvas renderer (for large graphs), use `.toDataURL()` to generate the PNG.

---

### US-033: "Chat with this File" (Targeted AI Context)

**Labels:** `epic/ai`
**Milestone:** Sprint 6 — Weeks 11–12

---

**As a** developer
**I want** to click on a specific file node in the graph and ask the AI questions strictly about that file
**So that** I can deep-dive into complex files without the global search retrieving unrelated context

**Acceptance Criteria**
- [ ] Context menu / Details panel for a node includes a "Chat with this file" action
- [ ] Triggers a targeted AI chat panel where the context is forcibly scoped only to the selected file's content (and optionally its direct imports)
- [ ] Disables standard RAG similarity search for this chat session
- [ ] Prompts the user with file-specific suggestions like "Explain what this file does" or "Find potential bugs in this code"

**Note**
> Instead of embedding a natural language query, fetch the full content of the selected file directly from the database and pass it as the exclusive `system` context to Claude.

---

### US-034: Team Organizations (Auto-invite GitHub Collaborators)

**Labels:** `epic/auth` `epic/dashboard`
**Milestone:** Sprint 8 — Weeks 15–16

---

**As a** lead developer
**I want** to form a Team dynamically based on my GitHub repo collaborators
**So that** the entire team automatically gains access to the indexed graph and AI search without having to re-index the repo themselves

**Acceptance Criteria**
- [ ] "Create Team" flow allows a user to group repositories under a Team context
- [ ] The backend calls the GitHub API (`/repos/{owner}/{repo}/collaborators`) to fetch a list of authorized users
- [ ] When an authorized collaborator signs into CodeLens, they automatically see the Team's shared repositories on their Dashboard
- [ ] Shared repos only need to be indexed once, saving compute and API calls
- [ ] Access controls (RBAC) ensure users only see repositories they genuinely have GitHub access to

**Note**
> Supabase RLS policies will need updating. Instead of `user_id = auth.uid()`, create a `team_members` join table and adjust policies to permit access if a user is part of the `team_members` linking to the repository's team. Relying on the GitHub collaborators API adds a seamless "magic" invite experience.

---

## 🧪 EPIC: Quality & Developer Experience

---

### US-035: Automated Test Suite

**Labels:** `epic/infra`
**Milestone:** Sprint 6 — Weeks 11–12

---

**As a** developer
**I want** an automated test suite covering parsers, services, and key UI components
**So that** regressions are caught before they reach production and the CI/CD pipeline (US-030) has real tests to run

**Acceptance Criteria**
- [ ] Vitest configured in both `frontend/` and `backend/` with `npm test` scripts
- [ ] Backend unit tests for: each Tree-sitter parser (JS/TS, Python, C#), import path resolution, issue detection (circular deps, god files, dead code, high coupling), and embedding chunking logic
- [ ] Backend integration tests for: `POST /api/repos`, `POST /api/repos/:id/reindex`, `GET /api/repos/:id/analysis`, `POST /api/search/:id`, `POST /api/review/:id` (mocking Supabase + external APIs)
- [ ] Frontend component tests for: DependencyGraph (renders nodes/edges), MetricsPanel (sort, filter, risk highlighting), IssuesPanel (grouping, severity badges), SearchPanel (empty state, streaming display), CodeReviewPanel (mode toggle, validation)
- [ ] Coverage target: ≥70% line coverage on `backend/src/services/` and `backend/src/parsers/`
- [ ] All tests pass in under 60 seconds

**Note**
> Use Vitest for both frontend and backend — it's Vite-native, fast, and has a Jest-compatible API. Frontend tests use `@testing-library/react` + `jsdom`. Backend integration tests mock the Supabase client and external API calls (OpenAI, Anthropic, GitHub) to avoid real network calls. This story is a **prerequisite for US-030** (CI/CD) — without it, the pipeline only runs lint.

---

### US-036: Global Toast & Error Handling

**Labels:** `epic/dashboard`
**Milestone:** Sprint 6 — Weeks 11–12

---

**As a** developer using CodeLens
**I want** errors and success feedback to appear as polished, non-blocking toasts instead of browser `alert()` dialogs
**So that** the app feels production-grade and I never lose context when something goes wrong

**Acceptance Criteria**
- [ ] A `<ToastProvider>` context + `useToast()` hook mounted at the app root
- [ ] Toast variants: `success` (green), `error` (red), `warning` (amber), `info` (blue)
- [ ] Toasts appear bottom-right, stack vertically, auto-dismiss after 5 seconds, dismissible with ✕
- [ ] All 3 existing `alert()` calls replaced with `toast.error()` (ConnectGitHubModal, Dashboard, RepoView)
- [ ] A React error boundary wrapping the app catches unhandled render errors and shows a recovery UI
- [ ] API errors from `fetch()` in Dashboard, RepoView, ConnectGitHubModal, and UploadRepoModal surface as toasts instead of inline error blocks where appropriate
- [ ] Toasts animate in/out (slide + fade)

**Note**
> No third-party toast library — build a lightweight `Toast.jsx` component with a `ToastProvider` context that manages a toast queue. Each toast is an object `{ id, type, message, duration }`. The provider renders a fixed-position container in the bottom-right corner. Use Tailwind transitions for the slide/fade animation. The error boundary should offer a "Reload page" button and optionally log the error to the console.

---

### US-037: Repository File Browser

**Labels:** `epic/graph` `epic/ai`
**Milestone:** Sprint 6 — Weeks 11–12

---

**As a** developer exploring a codebase
**I want** to browse the repository's file tree and read source code directly within CodeLens
**So that** I don't have to leave the app to understand what a file actually contains

**Acceptance Criteria**
- [ ] New "Files" tab added to the repo sidebar navigation (between Metrics and Issues)
- [ ] Left panel: collapsible directory tree built from `graph_nodes` file paths
- [ ] Right panel: syntax-highlighted source code viewer (using `react-syntax-highlighter`, already a dependency)
- [ ] File content fetched from `code_chunks` table — concatenated chunks for the selected file, ordered by `start_line`
- [ ] Backend endpoint: `GET /api/repos/:repoId/file?path=src/index.js` returns full file content from stored chunks
- [ ] Clicking a file in the tree loads its content; active file highlighted in the tree
- [ ] Line numbers displayed; clicking a line number copies `filename:lineNumber` to clipboard
- [ ] If a file has no stored chunks (unsupported language), show a "No indexed content for this file" message
- [ ] File tree shows language icons (coloured dots matching the graph's language colour scheme)

**Note**
> The directory tree is built entirely from the `graph_nodes` file paths — split each path by `/` and build a nested tree structure client-side. No extra API call needed for the tree itself. The file content endpoint queries `code_chunks WHERE repo_id = $1 AND file_path = $2 ORDER BY start_line ASC` and concatenates the `content` fields. If no chunks exist for a file, return a 404 with a descriptive message. Reuse the syntax highlighter theme from `SharedAnswerComponents.jsx` for visual consistency.

---

### US-038: Extended Language Support

**Labels:** `epic/parsing`
**Milestone:** Sprint 7 — Weeks 13–14

---

**As a** developer working in Go, Java, Rust, or Ruby
**I want** CodeLens to parse and index my repository's files
**So that** I can use the full dependency graph, issue detection, and AI search features regardless of the language I work in

**Acceptance Criteria**
- [ ] Go (`.go`) files parsed — `import` declarations extracted and resolved to repo-relative paths
- [ ] Java (`.java`) files parsed — `import` statements and `package` declarations extracted; imports resolved via package-to-directory mapping
- [ ] Rust (`.rs`) files parsed — `use` and `mod` declarations extracted; `mod foo` resolved to `foo.rs` or `foo/mod.rs`
- [ ] Ruby (`.rb`) files parsed — `require_relative` calls extracted and resolved; `require` calls matched against repo files
- [ ] Each new language has its own parser module under `backend/src/parsers/` following the same interface as existing parsers: `parse(filePath, content, allFilePaths) → { filePath, imports: string[], exports: string[] }`
- [ ] Language colour scheme in the D3 graph updated: Go → cyan, Java → orange, Rust → red-orange, Ruby → red
- [ ] Frontend language labels in `formatLanguage()` (RepoView.jsx) updated
- [ ] `SUPPORTED_EXTENSIONS` array in the indexer updated to include `.go`, `.java`, `.rs`, `.rb`
- [ ] Homepage language list updated to include the four new languages

**Note**
> Use Tree-sitter grammars: `tree-sitter-go`, `tree-sitter-java`, `tree-sitter-rust`, `tree-sitter-ruby` — all are available on npm. Add them to `backend/package.json`. Follow the exact same parser structure as `parseJavaScript.js` or `parsePython.js`. Wrap each file parse in try/catch and skip on failure — the pipeline must continue even if a single file fails. Import resolution for each language:
> - **Go:** `import "mymodule/utils"` → find `utils/` directory or `utils.go` in repo root
> - **Java:** `import com.example.MyClass` → look for `MyClass.java` anywhere in the repo tree
> - **Rust:** `mod foo` → look for `foo.rs` or `foo/mod.rs` relative to current file; `use crate::foo::bar` → resolve within repo
> - **Ruby:** `require_relative './helper'` → resolve relative to current file

---

## 🔧 EPIC: Technical Debt & Hardening

---

### US-039: Move GitHub access token to Supabase Vault

**Labels:** `epic/infra` `epic/auth` `database`
**Milestone:** Sprint 9 — Weeks 17–18

---

**As a** developer concerned about credential security
**I want** GitHub access tokens stored encrypted in Supabase Vault instead of plaintext on the `profiles` table
**So that** a database breach does not immediately leak every user's GitHub credentials

**Acceptance Criteria**
- [ ] Supabase Vault enabled on the project
- [ ] A new `github_token_secret_id` column (UUID) added to `profiles` that references the Vault secret
- [ ] Backend OAuth callback writes tokens via `vault.create_secret()` instead of directly into the column
- [ ] Backend GitHub service retrieves tokens via the `vault.decrypted_secrets` view at request time only — tokens are never held in memory beyond the single request
- [ ] Tokens never appear in application logs — add a redaction helper used by all loggers
- [ ] One-time idempotent migration script backfills existing plaintext tokens into Vault, writes the secret ID back to the row, then nulls the `github_access_token` column
- [ ] After backfill is verified, the `github_access_token` column is dropped
- [ ] The `TODO` comment in `schema.sql` and in the US-001 note is resolved

**Note**
> Reference: https://supabase.com/docs/guides/database/vault. Vault uses pgsodium under the hood. Only the service role key should be used to read `vault.decrypted_secrets` — never expose that view via RLS. Wrap the backfill in a `DO $$ ... $$` block that skips rows already migrated (`WHERE github_token_secret_id IS NULL AND github_access_token IS NOT NULL`) so it is safe to re-run. After the column is dropped, update `schema.sql` to remove the field and leave a migration note explaining the history.

---

### US-040: Real cyclomatic complexity calculation

**Labels:** `epic/parsing`
**Milestone:** Sprint 9 — Weeks 17–18

---

**As a** developer reviewing repository metrics
**I want** the complexity score to reflect actual cyclomatic complexity computed from the AST, not a line-count approximation
**So that** the metrics table and issue detection flag genuinely complex files instead of just large ones

**Acceptance Criteria**
- [ ] A shared `calculateComplexity(tree, language)` helper computes cyclomatic complexity per function from a Tree-sitter parse tree
- [ ] Complexity per function = count of decision points + 1: `if`, `else if`, `case`, `for`, `while`, `do`, `&&`, `||`, `? :`, `catch`, and language-specific equivalents
- [ ] File-level complexity = sum of per-function complexities (or 1 if the file has no functions)
- [ ] `graph_nodes.complexity_score` stores this value — the placeholder formula is removed
- [ ] High-coupling and god-file issue detection thresholds re-tuned against the new distribution and documented
- [ ] The `// TODO: replace with cyclomatic complexity in Sprint 9` comment from US-015 is removed
- [ ] The Metrics table risk highlighting (90th percentile logic) works unchanged because the column type and range are compatible
- [ ] README and CLAUDE.md updated to describe the new metric and its rationale

**Note**
> Language-specific decision-point node types:
> - **JS/TS:** `if_statement`, `else_clause`, `for_statement`, `while_statement`, `do_statement`, `switch_case`, `ternary_expression`, `catch_clause`, plus `binary_expression` where the operator is `&&` or `||`
> - **Python:** `if_statement`, `elif_clause`, `for_statement`, `while_statement`, `except_clause`, `boolean_operator`, `conditional_expression`
> - **C#:** `if_statement`, `else_clause`, `for_statement`, `while_statement`, `do_statement`, `switch_section`, `conditional_expression`, `catch_clause`, `conditional_access_expression`
> Keep the logic in one shared helper so parsers added in US-038 (Go, Java, Rust, Ruby) plug in by providing a node-type map.

---

### US-041: Migrate pgvector index from IVFFlat to HNSW

**Labels:** `epic/infra` `database`
**Milestone:** Sprint 9 — Weeks 17–18

---

**As a** developer searching large repositories
**I want** the pgvector index on `code_chunks` to use HNSW instead of IVFFlat
**So that** semantic search returns results with lower latency and higher recall as the corpus grows

**Acceptance Criteria**
- [ ] pgvector extension is verified at version ≥ 0.5.0 (HNSW requires it)
- [ ] Migration drops the existing IVFFlat index on `code_chunks.embedding`
- [ ] A new HNSW index is created: `CREATE INDEX ON code_chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`
- [ ] A benchmark script added to `backend/scripts/benchmark-vector-search.js` measures query latency and recall@8 on a ≥10k-chunk repo before and after
- [ ] `schema.sql` updated to reflect the new index definition
- [ ] Before/after latency numbers added to the README
- [ ] RAG search endpoint optionally sets `hnsw.ef_search` per request when higher recall is needed (`SET LOCAL hnsw.ef_search = 100`)

**Note**
> HNSW trades longer index build time and more memory for faster and more accurate queries — the right tradeoff for a read-heavy RAG workload. The `m` parameter controls graph connectivity (higher = better recall, more memory); `ef_construction` controls build-time effort. For 1536-dim embeddings, `m=16, ef_construction=64` is a good starting point. Since every repo is re-indexed from scratch and the table is small per repo, the migration is effectively zero-downtime — just run it.

---

### US-042: Rate limiting and AI cost controls

**Labels:** `epic/infra` `epic/ai`
**Milestone:** Sprint 9 — Weeks 17–18

---

**As a** project maintainer paying for OpenAI, Anthropic, and Groq API usage
**I want** per-user rate limits and a daily token budget across all AI endpoints
**So that** a single user or a runaway script cannot exhaust the API credits or take the service down

**Acceptance Criteria**
- [ ] New table `api_usage` with columns `{ id, user_id, endpoint, provider, prompt_tokens, completion_tokens, embedding_tokens, created_at }` and an index on `(user_id, created_at)`
- [ ] Middleware on `/api/search/*`, `/api/review/*`, and the indexing embedding calls records actual token usage pulled from provider response bodies
- [ ] A per-user daily token budget enforced across all providers combined — default 500k tokens/day, configurable via `MAX_DAILY_TOKENS_PER_USER` env var
- [ ] A per-user rate limit: 30 requests/minute and 500 requests/hour on AI endpoints, enforced via a token-bucket strategy
- [ ] When a limit is exceeded, the endpoint returns `429` with a JSON body `{ error, retryAfterSeconds }` and the user sees a clear toast
- [ ] Admin-only `GET /api/admin/usage` endpoint returns aggregate usage across all users, gated by a hardcoded admin user-ID list from env
- [ ] A small "Today: X / Y tokens" indicator on the user profile dropdown in the sidebar
- [ ] `.env.example` documents the new variables: `MAX_DAILY_TOKENS_PER_USER`, `MAX_RPM`, `MAX_RPH`, `ADMIN_USER_IDS`

**Note**
> `express-rate-limit` covers the request-count limits cleanly — one limiter per endpoint group. Token budgets must persist across restarts, so store aggregates in Supabase and compute daily usage with a rolling `WHERE created_at > NOW() - INTERVAL '24 hours'` query. Token extraction per provider: OpenAI returns `usage.prompt_tokens` / `usage.completion_tokens`, Anthropic returns `usage.input_tokens` / `usage.output_tokens`, Groq follows the OpenAI format, embeddings return `usage.total_tokens`. Skip billing for vector similarity queries — those are free. The UI indicator is a small nice-to-have that also helps users self-regulate and makes the system feel transparent.

---

### US-043: Full file content storage for file browser accuracy

**Labels:** `epic/infra` `database`
**Milestone:** Sprint 9 — Weeks 17–18

---

**As a** developer browsing a file in the repository file browser
**I want** to see the complete source file, not a reconstruction from indexed chunks with gaps between them
**So that** the file browser actually shows what's in the repo instead of a misleading best-effort assembly

**Acceptance Criteria**
- [ ] New table `file_contents` with columns `{ id, repo_id, file_path, content, byte_size, created_at }` and `UNIQUE (repo_id, file_path)`
- [ ] Indexing pipeline writes each file's full raw content to `file_contents` in addition to chunking it into `code_chunks`
- [ ] The `GET /api/repos/:repoId/file?path=...` endpoint from US-037 reads from `file_contents` instead of concatenating chunks
- [ ] A per-file size cap of 1 MB — files above the cap are stored with a truncation marker in their content and a `byte_size` that reflects the original
- [ ] Re-indexing deletes the repo's existing `file_contents` rows before re-inserting (same pattern as `code_chunks`)
- [ ] RLS on `file_contents` mirrors `code_chunks` — access is mediated through the `repositories` ownership check
- [ ] Migration marks all existing repos as `status = 'pending'` so the user's next visit triggers a re-index that populates the new table (one-time inconvenience, clearly messaged in the UI)
- [ ] `schema.sql` updated with the new table

**Note**
> This resolves a subtle bug in US-037: because chunking splits at function/class boundaries, everything between chunks (imports, top-level statements, comments, blank lines) is invisible in any "reconstructed" view. Storing the full content is the cleanest fix. The 1 MB cap is generous — very few source files exceed it. Storage impact is modest: a 1k-file repo averaging 10 KB per file is ~10 MB. Update `frontend/src/components/FileBrowser.jsx` to hit the new endpoint; the response shape is identical to the old chunk-concat version.

---

## 🔒 EPIC: Security

---

### US-044: Secret scanning during indexing

**Labels:** `epic/security` `epic/parsing`
**Milestone:** Sprint 10 — Weeks 19–20

---

**As a** developer indexing a repository
**I want** CodeLens to scan every file for hardcoded secrets during indexing
**So that** I immediately learn if my repo contains credentials that should never have been committed

**Acceptance Criteria**
- [ ] A `secretScanner` service in `backend/src/services/` runs against every file during indexing
- [ ] Detects at minimum: AWS access keys and secret keys, GitHub personal access tokens, GitHub OAuth tokens, OpenAI keys (`sk-...`), Anthropic keys (`sk-ant-...`), Stripe live keys (`sk_live_`, `pk_live_`, `rk_live_`), Google API keys (`AIza...`), Slack tokens (`xox[baprs]-...`), JWT-shaped strings, RSA/OpenSSH private key blocks
- [ ] Detects generic high-entropy strings (Shannon entropy > 4.5 over ≥20 chars) assigned to variables matching `*_key`, `*_secret`, `*_token`, `*_password`
- [ ] New `issue_type` enum value `'hardcoded_secret'` added via migration
- [ ] Each detection creates an `analysis_issues` row with `severity: 'high'`, `file_paths: [path]`, and a description containing the line number and the rule ID — **never** the secret value itself
- [ ] Per-file scan wrapped in try/catch with a 2-second timeout to prevent ReDoS on malicious repos
- [ ] Issues panel groups these under a "Hardcoded Secrets" section with a lock icon
- [ ] A "Mark as false positive" action per issue persists the suppression in a new `issue_suppressions` table `{ repo_id, file_path, rule_id, line_number, created_by, created_at }` so re-indexing does not re-flag it
- [ ] Rules defined in a JSON config at `backend/src/sast/secret-rules.json` so new patterns can be added without code changes

**Note**
> Gitleaks' ruleset (https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml) is the industry reference — port the regex patterns into a JS-compatible format. Absolutely do **not** include secret values in descriptions, logs, or error messages — only the rule ID and line number. Rule config example:
> ```json
> { "id": "aws_access_key", "pattern": "AKIA[0-9A-Z]{16}", "entropy": 0, "severity": "high" }
> ```
> The `issue_suppressions` table is reused by US-049 — design the columns to be rule-agnostic. (US-046 uses a separate per-repo `sast_disabled_rules` column for whole-rule toggles, which is a different concept from per-instance suppression.)

---

### US-045: Dependency vulnerability scanning (SCA)

**Labels:** `epic/security` `epic/parsing`
**Milestone:** Sprint 10 — Weeks 19–20

---

**As a** developer indexing a repository
**I want** CodeLens to check my dependency manifests against the OSV vulnerability database
**So that** I learn which of my dependencies have known CVEs and what versions fix them

**Acceptance Criteria**
- [ ] Indexing pipeline detects and parses: `package.json` + `package-lock.json` / `yarn.lock`, `requirements.txt`, `Pipfile.lock`, `go.mod`, `Cargo.lock`, `Gemfile.lock`, `*.csproj`
- [ ] For each detected `(ecosystem, package, version)`, a batched query to the OSV.dev API (`https://api.osv.dev/v1/querybatch`) returns known vulnerabilities
- [ ] New `issue_type` enum value `'vulnerable_dependency'` added via migration
- [ ] Each vulnerability creates an `analysis_issues` row with severity derived from the CVSS score (`low < 4`, `medium 4–7`, `high > 7`), `file_paths: [manifest_path]`, and a description naming the CVE ID, affected package/version, the lowest fixed version, and a link to the OSV advisory
- [ ] Issues panel groups these under "Vulnerable Dependencies"
- [ ] A dedicated "Dependencies" tab on the repo page lists every detected package with its version and vulnerability status (clean / N issues)
- [ ] OSV calls batched in groups of 100 and cached for 24 hours in a new `vulnerability_cache` table keyed on `(ecosystem, name, version)` to avoid rate limits across users/repos
- [ ] If OSV is unreachable, indexing completes successfully and logs a warning — SCA is best-effort and never blocks the pipeline

**Note**
> OSV.dev is free, requires no API key, and covers npm, PyPI, Go, RubyGems, crates.io, NuGet, and Maven. The batch endpoint accepts up to 1000 queries per request. Request shape:
> ```json
> { "queries": [{ "package": { "name": "express", "ecosystem": "npm" }, "version": "4.17.1" }] }
> ```
> For `package-lock.json`, flatten the full `dependencies` tree to catch transitive vulnerabilities. For `requirements.txt` without a lockfile, only direct deps can be checked and this limitation should be shown in the UI. Cache entries expire after 24 hours — a simple `created_at > NOW() - INTERVAL '24 hours'` filter is sufficient.

---

### US-046: Pattern-based SAST with AST queries

**Labels:** `epic/security` `epic/parsing`
**Milestone:** Sprint 10 — Weeks 19–20

---

**As a** developer indexing a repository
**I want** CodeLens to run static security checks against dangerous code patterns via AST queries
**So that** common vulnerability classes (eval injection, command injection, weak crypto, unsafe deserialization) get flagged without me running a separate tool

**Acceptance Criteria**
- [ ] A `sastEngine` service in `backend/src/services/` runs during indexing after AST parsing completes
- [ ] Each rule is an AST query (Tree-sitter query string or small walker function) stored under `backend/src/sast/rules/<language>/`
- [ ] Initial ruleset (minimum):
  - [ ] **JS/TS:** `eval(...)`, `new Function(...)`, `dangerouslySetInnerHTML`, `child_process.exec`/`execSync` with template literals, `require()` with a non-literal argument, `document.write`
  - [ ] **Python:** `eval()`, `exec()`, `pickle.loads()`/`pickle.load()`, `subprocess.*(shell=True)`, raw SQL built with `%` or f-string formatting, `yaml.load()` without `SafeLoader`
  - [ ] **C#:** `Process.Start` with concatenated arguments, `SqlCommand` with string-concatenated SQL, use of `MD5`, `SHA1`, `DES`, `RC4`, `TripleDES`
  - [ ] **Cross-language:** hardcoded IPv4 addresses, `http://` URLs in non-test source
- [ ] New `issue_type` enum value `'insecure_pattern'` added via migration
- [ ] Each detection creates an `analysis_issues` row with severity per the rule, `file_paths: [path]`, and a description citing the CWE where applicable
- [ ] Issues panel groups these under "Insecure Code Patterns"
- [ ] Rules can be disabled per-repo via a new `sast_disabled_rules TEXT[]` column on `repositories`
- [ ] Each rule has metadata `{ id, name, severity, cwe, description, fixHint }` with the fix hint shown when an issue is expanded in the UI

**Note**
> Tree-sitter's built-in query language makes rule expression concise. Example JS rule for `eval()`:
> ```
> (call_expression
>   function: (identifier) @fn
>   (#eq? @fn "eval"))
> ```
> Semgrep's open-source ruleset (https://github.com/semgrep/semgrep-rules) is the gold standard for what patterns to port — start with 10–15 high-value rules per language rather than thousands. CWE references (https://cwe.mitre.org/) make the output feel professional: `eval()` → CWE-95, weak crypto → CWE-327, SQL concatenation → CWE-89. This is pattern matching, not taint analysis — false positives are expected and the per-repo rule-disable escape hatch keeps the tool usable.

---

### US-047: Attack surface mapping on the dependency graph

**Labels:** `epic/security` `epic/graph`
**Milestone:** Sprint 11 — Weeks 21–22

---

**As a** developer analysing a codebase's security posture
**I want to** visualise which files are externally reachable "sources" and which are sensitive "sinks", with highlighted paths between them
**So that** I can see at a glance which parts of my architecture form the attack surface and what sensitive operations they can reach

**Acceptance Criteria**
- [ ] Indexing pipeline classifies each file as `source`, `sink`, `both`, or `null`
- [ ] **Source** heuristics (per language): files registering HTTP routes (Express, Koa, Flask, FastAPI, ASP.NET controllers), CLI entry points reading from `process.argv`/`sys.argv`/`Environment.GetCommandLineArgs`, files reading stdin
- [ ] **Sink** heuristics: files executing SQL, shell commands, filesystem writes with dynamic paths, deserialization calls (`pickle.loads`, `JSON.parse` of input, XML deserialisers), outbound HTTP with dynamic URLs
- [ ] A new `node_classification TEXT` column added to `graph_nodes` (nullable)
- [ ] New "Attack Surface" toggle on the graph view: with it on, sources render with a red halo, sinks with an orange halo, neutral nodes dimmed
- [ ] A "Show reachable paths" action on any source highlights every graph path that reaches a sink, with intermediate nodes in yellow
- [ ] Per-source badge: "N paths reach a sink from this file"
- [ ] Right-hand panel lists all `source → ... → sink` paths sorted by length ascending, capped at 50 with "... X more" expand
- [ ] If the graph has zero sources or zero sinks, a positive empty state: "No externally reachable endpoints detected — or this repo is a library."

**Note**
> This is lightweight reachability analysis, not sound taint analysis — the goal is architectural visibility, not a proof of exploitability. Implementation: BFS from each source forward through the `graph_edges` adjacency map; mark any node reached, and record full paths that terminate at a sink. Classification reuses Tree-sitter queries built for US-046 — look for AST nodes matching `app.get`, `app.post`, `@app.route`, `@router.get`, `[HttpGet]` etc. For large graphs with many pairs, cap displayed paths at 50 and expose the full set via a JSON export (same pattern as US-021). This feature is genuinely differentiated — no mainstream SAST tool overlays attack surface on a dependency graph the way CodeLens can.

---

### US-048: AI security audit mode

**Labels:** `epic/security` `epic/ai`
**Milestone:** Sprint 11 — Weeks 21–22

---

**As a** developer worried about security issues I can't catch with pattern matching alone
**I want** an AI-powered security audit that reviews my code with a security-focused system prompt and repo-specific context
**So that** I get expert-grade explanations of subtle issues grounded in my actual codebase

**Acceptance Criteria**
- [ ] Code Review panel (US-026) extended with a mode toggle: "General" | "Security Audit"
- [ ] Security mode uses a security-focused system prompt instructing Claude to assess for: injection vulnerabilities, auth/authz flaws, crypto misuse, secrets exposure, input validation gaps, error-handling information leaks, dependency risks, and logic flaws
- [ ] Retrieval in security mode re-ranks retrieved chunks by co-occurrence with security-relevant keywords (`auth`, `password`, `token`, `crypto`, `sanitize`, `exec`, `eval`, `sql`)
- [ ] Response is a streamed list of findings, each `{ severity, category, line_reference, explanation, suggested_fix, confidence }`
- [ ] A new "Audit this file" action on the file details panel pre-fills the review panel with the file content in Security Audit mode
- [ ] A whole-repo "Run security audit" action runs the audit against the top 20 files ranked by `incoming_count + complexity_score` and produces a summary report
- [ ] The whole-repo audit is persisted in a new `security_audits` table `{ id, user_id, repo_id, findings_json, created_at }` so users can see history
- [ ] Audit findings cross-link to deterministic `analysis_issues` rows (US-044 / US-046) that affect the same file — users see where AI and deterministic detection agree
- [ ] Token usage counted against the user's daily budget from US-042

**Note**
> Reuse the SSE streaming from `searchController.js`. The confidence field is critical — users should know when Claude is certain vs. guessing. Suggested system prompt: "You are a security engineer reviewing code for vulnerabilities. Analyse the snippet in the context of the provided codebase excerpts. For each potential issue, identify the vulnerability type, cite the specific line, rate severity (low/medium/high), estimate confidence (low/medium/high), and suggest a concrete fix. If the code looks secure, say so explicitly — do not invent issues." The whole-repo audit is capped at 20 files to keep cost bounded; file selection surfaces the highest-leverage files rather than a random sample.

**⚠️ Implementation note — overlap with existing "Security" preset**
> `CodeReviewPanel.jsx` already ships a lightweight "Security" focus preset (one of four preset buttons: Security, Performance, Bug Hunt, Architecture) that prepends a security-focused instruction to the review context. This is intentionally shallow — it does not change retrieval ranking, structured output format, or support whole-repo auditing.
>
> When implementing US-048, **do not add a separate toggle** alongside the existing presets. Instead:
> 1. Remove the "Security" preset button from the four-preset row.
> 2. Replace it with the full "Security Audit" mode toggle described in this story (with its own system prompt, re-ranked retrieval, structured findings output, and "Audit this file" / "Run full audit" actions).
> 3. Keep the remaining three presets (Performance, Bug Hunt, Architecture) as-is — they are lightweight focus hints and do not conflict.

---

### US-049: Authentication coverage check

**Labels:** `epic/security` `epic/parsing`
**Milestone:** Sprint 11 — Weeks 21–22

---

**As a** developer building a web application
**I want** CodeLens to flag route handlers that do not appear to enforce authentication
**So that** I catch accidentally public endpoints before they ship

**Acceptance Criteria**
- [ ] Indexing pipeline identifies route-handler files — reuses the source classification from US-047
- [ ] For each route handler, checks whether the file (a) transitively imports a file whose path or name suggests auth middleware (`auth`, `authn`, `authz`, `authenticate`, `requireAuth`, `middleware/auth*`, `guards/*`), or (b) contains in-file auth markers (`@login_required`, `@authorize`, `[Authorize]`, `passport.authenticate`, or a user-configured custom helper name)
- [ ] Files registering routes with no detected auth coverage create an `analysis_issues` row of new type `'missing_auth'` with severity `medium` and a description naming the specific route paths that appear unprotected
- [ ] Issues panel groups these under "Potentially Unauthenticated Routes"
- [ ] Default allow-list (to reduce noise) covers: `/health`, `/healthz`, `/ping`, `/status`, `/metrics`, `/favicon.ico`, `/login`, `/signup`, `/register`, `/auth/*`, `/oauth/*`, `/.well-known/*`
- [ ] Users can mark specific routes as "intentionally public" via the `issue_suppressions` table from US-044 — suppressions persist across re-indexing
- [ ] False positive rate ≤30% on the Sprint 6 test repos — tune heuristics until it is

**Note**
> This is deliberately a heuristic and will have false positives. That is acceptable as long as the UI clearly labels findings as "Potentially" unauthenticated and the suppression workflow is fast. The detection is two-layered: (1) AST scan within the file for auth-ish identifiers, (2) graph traversal checking if any imported module has an auth-sounding name. If either succeeds, the route is considered covered. This story depends on US-047 for route detection — land them in the same sprint.

---

## 📊 EPIC: Analytics & Growth

---

### US-050: Git history hotspots

**Labels:** `epic/analytics` `epic/graph`
**Milestone:** Sprint 12 — Weeks 23–24

---

**As a** developer deciding where to invest refactoring effort
**I want** to see which files change most frequently combined with their complexity
**So that** I can identify true refactoring hotspots — files that are both fragile and actively evolving

**Acceptance Criteria**
- [ ] Indexing pipeline fetches the last 12 months of Git commit metadata for GitHub-connected repos (file paths and stats per commit — not full blobs)
- [ ] New table `file_churn` stores `{ id, repo_id, file_path, commit_count, last_modified, unique_authors, lines_changed }` with `UNIQUE (repo_id, file_path)`
- [ ] A "Hotspots" toggle on the Metrics tab sorts the table by `hotspot_score = normalize(commit_count) × normalize(complexity_score)` descending
- [ ] Graph view gains a "Hotspot" colour mode: nodes coloured on a green→yellow→red gradient by `hotspot_score` normalised against the repo's own distribution
- [ ] Issues panel gains a "Refactoring Candidates" section listing the top 10 hotspots with churn and complexity numbers
- [ ] Upload-source repos show a helpful message: "Hotspot analysis requires Git history — connect this project via GitHub to enable."
- [ ] Re-indexing a GitHub repo refreshes the churn data
- [ ] Webhook-triggered re-indexes (US-028) incrementally update churn for changed files only rather than recomputing from scratch

**Note**
> Adam Tornhill's "Code as a Crime Scene" idea — files that change often *and* are complex are where bugs cluster and where refactoring pays off most. Use Octokit's `listCommits` with `since = 12 months ago`, paginated; for each commit use `getCommit` to extract per-file `additions`/`deletions`. Cap at the 1000 most recent commits to avoid hammering the GitHub API. The normalised gradient combined with force-directed layout makes clusters of hot, complex files visually jump out — it's striking demo material.

---

### US-051: Architectural diff between branches or commits

**Labels:** `epic/analytics` `epic/graph`
**Milestone:** Sprint 12 — Weeks 23–24

---

**As a** developer reviewing a pull request
**I want** to see how the architecture changes between two Git refs — which nodes and edges are added, removed, or modified
**So that** I can spot structural regressions (new circular deps, expanded blast radius, new god files) before merging

**Acceptance Criteria**
- [ ] A "Compare" button on the repo page opens a diff modal
- [ ] User selects two refs: base (default `main`) and head (default the current branch or a selected PR)
- [ ] Backend runs a parsing-only indexing pipeline for both refs — stores results in a scratch table (`diff_indexes`) so the primary index is not disturbed
- [ ] Diff computation produces: added nodes, removed nodes, added edges, removed edges, new issues, resolved issues, per-file complexity deltas
- [ ] Graph view renders the diff: added in green, removed in red (dashed), changed in amber, unchanged dimmed
- [ ] Summary panel: "+12 files, −3 files, +47 edges, −8 edges, 2 new issues (1 circular dep, 1 god file), 1 issue resolved"
- [ ] Results cached keyed on `(repo_id, base_sha, head_sha)` in a `diff_cache` table — re-opening the same diff is instant
- [ ] Webhook (US-028) on PR `opened` and `synchronize` events precomputes the diff against the PR base so reviewers find it ready
- [ ] Optional stretch: a GitHub App posts a summary comment on the PR linking to the full visualisation in CodeLens

**Note**
> This turns CodeLens from passive exploration into active code review and is one of the highest-leverage analytics features. Fetch the tree at a specific ref via `GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1`, then fetch blobs as needed. Skip embeddings for diff indexes — they aren't needed for structural diffing, which saves time and OpenAI spend. The PR bot is a stretch goal; for Sprint 12 the in-app modal is the must-have.

---

### US-052: Code duplication detection via embeddings

**Labels:** `epic/analytics` `epic/ai`
**Milestone:** Sprint 12 — Weeks 23–24

---

**As a** developer looking to reduce maintenance cost
**I want** CodeLens to find semantically similar code chunks across my repo
**So that** I can identify copy-pasted logic and extract it into shared utilities

**Acceptance Criteria**
- [ ] After indexing completes, a duplication detection job finds pairs of `code_chunks` (in the same repo) with cosine similarity > 0.92 spanning at least 10 lines each
- [ ] For repos with ≤5000 chunks, uses an all-pairs comparison; for larger repos, uses a pgvector k-NN self-query (top 5 neighbours per chunk) to keep runtime bounded
- [ ] Pairs stored in a new `duplication_candidates` table `{ id, repo_id, chunk_a_id, chunk_b_id, similarity }`
- [ ] Pairs grouped into clusters via union-find (if A~B and B~C, all three form one cluster)
- [ ] New "Duplication" section on the Issues tab lists clusters with: severity based on cluster size and total lines spanned, the file paths + line ranges, and a short excerpt
- [ ] Clicking a cluster opens a side-by-side syntax-highlighted view of all members
- [ ] An "Ask AI to extract shared utility" action sends the cluster to Claude and streams back a proposed refactor into the review panel
- [ ] Duplication data is cleared and recomputed on re-index — no stale data

**Note**
> Embedding similarity catches near-duplicates that textual hashing misses — e.g. two functions that do the same thing with different variable names. The 0.92 threshold is conservative; tune empirically. The scalable-mode SQL:
> ```sql
> SELECT a.id, b.id, 1 - (a.embedding <=> b.embedding) AS similarity
> FROM code_chunks a
> JOIN LATERAL (
>   SELECT id, embedding FROM code_chunks
>   WHERE repo_id = a.repo_id AND id != a.id
>   ORDER BY a.embedding <=> embedding
>   LIMIT 5
> ) b ON true
> WHERE a.repo_id = $1 AND 1 - (a.embedding <=> b.embedding) > 0.92;
> ```
> Union-find is a dozen lines of code. The AI refactor action reuses the existing review pipeline and counts against the US-042 token budget.

---

### US-053: Test coverage overlay on the dependency graph

**Labels:** `epic/analytics` `epic/graph`
**Milestone:** Sprint 12 — Weeks 23–24

---

**As a** developer assessing test health
**I want** to see which source files are referenced by tests overlaid on the dependency graph
**So that** I can spot untested critical files and prioritise where to write tests

**Acceptance Criteria**
- [ ] Indexing pipeline identifies test files by path convention: `*.test.{js,ts,tsx,jsx}`, `*.spec.{js,ts,tsx,jsx}`, `test_*.py`, `*_test.go`, `*Test.java`, `*Tests.cs`, and directory conventions `__tests__/`, `tests/`, `spec/`, `test/`
- [ ] For each test file, the existing parsers (US-009, US-010, US-011, US-038) resolve imports — any source file imported by a test file is marked "covered"
- [ ] A new `has_test_coverage BOOLEAN DEFAULT FALSE` column on `graph_nodes` populated during indexing
- [ ] A "Coverage" toggle on the graph view: covered nodes in green, uncovered in red, test files themselves in a distinct muted style
- [ ] A "Coverage gaps" section on the Metrics tab lists uncovered source files sorted by `incoming_count × complexity_score` descending — highest-leverage gaps first
- [ ] Summary line: "X of Y source files are referenced by at least one test (Z% by file)"
- [ ] If a `coverage.xml`, `coverage.json`, or LCOV file is present in the repo, parse it and use the real line-coverage percentages instead of the heuristic
- [ ] Uncovered files with high complexity or high `incoming_count` (above 90th percentile) create a new issue type `'untested_critical_file'` with severity `medium`

**Note**
> This is "is this file referenced by any test" coverage, not line-level — but the heuristic version is genuinely useful because it scales to any language without running a test runner. The LCOV upgrade path is an easy bolt-on: `lcov-parse` on npm handles it in a few lines. The combination with hotspots from US-050 is especially powerful — untested + high-churn + high-complexity = exactly where production incidents come from. Consider a later "Risk Matrix" story that visualises all three dimensions together.

**⚠️ Implementation note — schema and incremental indexing**
> `graph_nodes` already has a `content_hash TEXT` column added by the incremental re-indexing work (see `scripts/schema.sql`). Adding `has_test_coverage BOOLEAN DEFAULT FALSE` is a straightforward additional column — apply via:
> ```sql
> ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS has_test_coverage BOOLEAN DEFAULT FALSE;
> ```
>
> **Incremental indexing interaction:** Coverage must be recomputed from the complete edge graph on every re-index, not just for changed files. A test file changing its imports can affect the coverage status of source files that themselves haven't changed. The implementation should compute `has_test_coverage` from the full `allEdges` set (which is always rebuilt from scratch) and update it on all nodes during the final bulk upsert — not only on files in `changedFilePaths`. This is already how coupling metrics (`incoming_count`, `outgoing_count`) work, so the pattern is established.

---

## 🏷️ Suggested GitHub Labels

| Label | Color | Description |
|---|---|---|
| `epic/infra` | `#6B7280` | Infrastructure, database, and setup |
| `epic/auth` | `#7C3AED` | Authentication and sessions |
| `epic/dashboard` | `#0891B2` | Dashboard and navigation |
| `epic/graph` | `#2563EB` | Dependency graph and visualisation |
| `epic/parsing` | `#059669` | Tree-sitter AST parsing engine |
| `epic/ai` | `#D97706` | AI integration and RAG pipeline |
| `epic/search` | `#0D9488` | Natural language search feature |
| `epic/impact` | `#DC2626` | Change impact analysis feature |
| `epic/security` | `#B91C1C` | Security scanning, vulnerability detection, SAST |
| `epic/analytics` | `#9333EA` | Analytics, hotspots, diffs, coverage, growth features |
| `devops` | `#FCA5A5` | DevOps, CI/CD, and Hosting |
| `database` | `#1D4ED8` | Database schema and migrations |

---

## 📅 Milestones

| Milestone | Weeks | Stories |
|---|---|---|
| Sprint 1 — Foundation | Weeks 1–2 | US-001 → US-008 |
| Sprint 2 — Core Analysis Engine | Weeks 3–4 | US-009 → US-012 |
| Sprint 3 — Visualisation & Metrics | Weeks 5–6 | US-013 → US-016 |
| Sprint 4 — AI Layer & Impact Analysis | Weeks 7–8 | US-017 → US-021 |
| Sprint 5 — Polish & Stabilisation | Weeks 9–10 | US-022 → US-025, US-027 |
| Sprint 6 — Advanced Integrations & Quality | Weeks 11–12 | US-026, US-028, US-032, US-033, US-035, US-036, US-037 |
| Sprint 7 — DevOps & Deployment | Weeks 13–14 | US-029 → US-031 (US-030 depends on US-035), US-038 |
| Sprint 8 — Teams & Collaboration | Weeks 15–16 | US-034 |
| Sprint 9 — Technical Debt & Hardening | Weeks 17–18 | US-039 → US-043 |
| Sprint 10 — Security Suite (Part 1) | Weeks 19–20 | US-044 → US-046 |
| Sprint 11 — Security Suite (Part 2) | Weeks 21–22 | US-047 → US-049 |
| Sprint 12 — Analytics & Growth | Weeks 23–24 | US-050 → US-053 |
