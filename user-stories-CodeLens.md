# CodeLens — GitHub Issues / User Stories

Each story below is formatted as a GitHub Issue. Copy each one into GitHub Issues directly.

Assign labels: `epic/infra`, `epic/auth`, `epic/dashboard`, `epic/graph`, `epic/parsing`, `epic/ai`, `epic/search`, `epic/impact`

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
> Complexity score formula for Sprint 3: `line_count × (outgoing_count / total_nodes_in_repo)`. Mark with `// TODO: replace with cyclomatic complexity in Sprint 5`.

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
| `database` | `#1D4ED8` | Database schema and migrations |

---

## 📅 Milestones

| Milestone | Weeks | Stories |
|---|---|---|
| Sprint 1 — Foundation | Weeks 1–2 | US-001 → US-008 |
| Sprint 2 — Core Analysis Engine | Weeks 3–4 | US-009 → US-012 |
| Sprint 3 — Visualisation & Metrics | Weeks 5–6 | US-013 → US-016 |
| Sprint 4 — AI Layer & Impact Analysis | Weeks 7–8 | US-017 → US-021 |
| Sprint 5 — Polish & Stabilisation | Weeks 9–10 | US-022 → US-025 |
