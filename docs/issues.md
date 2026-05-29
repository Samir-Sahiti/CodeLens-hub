# CodeLens — New Issues: AI Refactor Proposals + Repo Agent

These stories extend `user-stories-CodeLens.md` with two new epics that take CodeLens beyond "AI as a wrapper around chat." Both leverage CodeLens's unique structural state — the dependency graph, deterministic issue findings, attack-surface classification, and metrics — as input to AI, rather than running AI over raw source the way Codex or Claude Code would.

Numbering continues from US-061. Build order is **refactor proposals first**, then the agent — the agent exposes `propose_fix` as a tool, so the refactor pipeline is a dependency.

---

## 🛠️ EPIC: AI Refactor Proposals

A "Propose fix" action on every issue card. The model gets the issue, the file, the structural context that's relevant to the issue type (e.g. for a god file: which exports each importer uses), and returns a structured proposal with a unified diff. The user can apply it as a draft PR or copy the diff.

---

### US-063: Refactor proposals database schema

**Labels:** `epic/refactor` `database`
**Milestone:** Sprint 14 — Weeks 27–28

---

**As a** developer
**I want to** persist AI-generated refactor proposals tied to specific issues
**So that** I can review existing proposals without regenerating them, and so the agent (US-067) can reuse cached proposals

**Acceptance Criteria**
- [ ] New `issue_proposals` table `{ id, issue_id, user_id, status, proposal_json, branch_name, pr_url, prompt_tokens, completion_tokens, created_at, updated_at }`
- [ ] `status` enum: `pending | applied | discarded | stale`
- [ ] `issue_id` foreign key to `analysis_issues(id) ON DELETE CASCADE`
- [ ] `user_id` foreign key to `auth.users(id) ON DELETE CASCADE`
- [ ] `proposal_json` JSONB holds the full `{ summary, rationale, changes, risks }` payload
- [ ] RLS enabled — users can read/write only their own proposals
- [ ] Index on `(issue_id, created_at DESC)` for "latest proposal for this issue" lookups
- [ ] Index on `(user_id, created_at DESC)` for a per-user history view
- [ ] `updated_at` trigger using the existing `set_updated_at()` function from US-054
- [ ] When the indexing pipeline detects a file's `content_hash` has changed, any `pending` proposal whose `changes[].file_path` references that file is updated to `status = 'stale'`
- [ ] Migration is idempotent in the same style as the existing `schema.sql` (DO blocks for enums, `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`)

**Note**
> Append the table to `scripts/schema.sql` so it remains the single source of truth. The stale-detection step belongs in the indexing pipeline near the existing `clear_repo_derived_data()` call — but it must run *before* `analysis_issues` is wiped, otherwise the FK is already gone. Easier: run a quick UPDATE inside indexing after the new `content_hash` row is written, joining proposals to issues to files:
> ```sql
> UPDATE issue_proposals p
> SET status = 'stale', updated_at = NOW()
> FROM analysis_issues i
> WHERE p.issue_id = i.id
>   AND i.repo_id = $1
>   AND p.status = 'pending'
>   AND i.file_path = ANY($2::text[]); -- changed file paths
> ```
> Keep `branch_name` and `pr_url` nullable — they're only populated once the user clicks Apply via PR (US-065).

---

### US-064: Refactor proposal generation endpoint

**Labels:** `epic/refactor` `epic/ai`
**Milestone:** Sprint 14 — Weeks 27–28

---

**As a** developer who sees an issue in the Issues panel
**I want to** generate a concrete refactor proposal for that issue with one click
**So that** I get a starting point grounded in the rest of my repo, not a generic "consider splitting this file" suggestion

**Acceptance Criteria**
- [ ] New endpoint `POST /api/repos/:repoId/issues/:issueId/proposals` streaming over SSE
- [ ] Server-side prompt routing by `analysis_issues.type` — each type pulls a different structural context bundle:
  - `god_file` → full file content + per-importer breakdown (which exports each importer uses)
  - `circular_dependency` → all files in the cycle + their interconnecting imports/exports
  - `high_coupling` → the file + top-5 most-coupled neighbours with sample call sites
  - `dead_code` → the file/symbol + confirmation of zero incoming edges and zero RAG matches
  - `missing_auth` → the route definition + the repo's detected auth middleware patterns (reuses US-049 detection)
  - `hardcoded_secret` → the line + the repo's `.env.example` if present
  - `vulnerable_dependency` → the manifest entry + fix version + sample call sites of the affected package
- [ ] Anthropic Claude (`claude-sonnet-4-20250514` via existing `@anthropic-ai/sdk`) called with the prompt; response parsed into structured shape:
  ```ts
  { summary: string,
    rationale: string,
    changes: { file_path: string, action: 'create'|'modify'|'delete', diff: string }[],
    risks: string[] }
  ```
- [ ] SSE events: `summary_delta` (streamed text), `change` (per file as it completes), `risk` (per risk item), `done` (final `proposal_id`), `error`
- [ ] Diff format is unified diff so the same blob can be applied via `git apply` or fed to GitHub's contents API in US-065
- [ ] On successful completion, persists to `issue_proposals` with `status = 'pending'`
- [ ] Reuses `aiRateLimit` middleware (US-042) — counts against the user's daily token budget
- [ ] If a `pending` non-stale proposal already exists for this issue, returns it from cache without re-calling Claude unless `?regenerate=true` is passed

**Note**
> The per-importer breakdown for god files is the magic ingredient — without it Claude has no idea where to draw the seams. Compute it as:
> ```sql
> SELECT importer.file_path, array_agg(DISTINCT edge.symbol) AS used_symbols
> FROM graph_edges edge
> JOIN graph_nodes importer ON importer.file_path = edge.from_path
> WHERE edge.to_path = $1 AND edge.repo_id = $2
> GROUP BY importer.file_path;
> ```
> If `graph_edges` doesn't track symbols yet, the file paths alone are still useful — Claude can read the importer files via `code_chunks` to infer usage. Land this story alongside an optional `graph_edges.symbol` column if it doesn't already exist.
>
> Suggested system prompt opening (god file case): *"You are a senior engineer proposing a refactor to split a god file. Output a JSON object with the schema below. The current file is at {path}. Here are the importers and which symbols each one uses. Propose a split that minimises cross-cuts. For each new file, provide the full content as a 'create' action. For the original file, provide a 'modify' action that re-exports from the new files for backward compatibility unless explicitly safe to break."*
>
> Cap input context at ~30k tokens — for very large god files, truncate to the top-N most-imported sections. Risks list is critical — surfaces uncertainty the user can act on.

---

### US-065: Proposal review panel UI

**Labels:** `epic/refactor` `epic/dashboard`
**Milestone:** Sprint 14 — Weeks 27–28

---

**As a** developer reviewing a refactor proposal
**I want to** see the summary, rationale, per-file diffs, and risks in one place
**So that** I can decide whether to apply it or discard it without leaving the app

**Acceptance Criteria**
- [ ] New "Propose fix" button on every `IssueCard` in `IssuesPanel`
- [ ] Clicking it opens a right-side slide-in panel (`ProposalPanel`) sized similarly to the existing Impact Analysis panel
- [ ] If a non-stale proposal already exists for this issue, render it immediately; otherwise stream a new one via the SSE endpoint from US-063
- [ ] Panel sections: title with issue type + file path, streaming `Summary`, `Rationale`, per-file `Changes` (file path header + unified diff with syntax highlighting), `Risks` list
- [ ] Diff renderer: reuse `react-syntax-highlighter` with a unified-diff language definition; render added lines green, removed red, context dimmed
- [ ] Action row: **Apply via PR** (primary, opens US-065 flow), **Copy diff** (copies all diffs concatenated to clipboard), **Discard** (sets `status = 'discarded'` and closes panel), **Regenerate** (calls endpoint with `?regenerate=true`)
- [ ] Stale proposals show a banner "This file has changed since this proposal was generated" with a Regenerate CTA
- [ ] Cancel button while streaming aborts the SSE via `AbortController`
- [ ] Loading state uses skeleton blocks matching the eventual layout (no raw spinner) — consistent with US-023

**Note**
> Reuse the `FindingCard` styling conventions from the security audit panel for visual consistency. The diff renderer is the one piece of net-new UI work; consider `react-diff-viewer-continued` if you don't want to roll your own — it's a small dep and supports unified diff out of the box. Make sure long diffs are scrollable inside the panel, not expanding the panel itself off-screen. Keep the panel keyboard-dismissible (Escape) for the same reason every other slide-in panel is.

---

### US-066: GitHub draft PR creation from a proposal

**Labels:** `epic/refactor` `epic/infra`
**Milestone:** Sprint 14 — Weeks 27–28

---

**As a** developer who likes a proposal
**I want to** turn it into a draft pull request on GitHub with one click
**So that** I can review the changes in GitHub's diff UI, run CI on them, and discuss with the team before merging

**Acceptance Criteria**
- [ ] New endpoint `POST /api/repos/:repoId/proposals/:proposalId/apply` returning `{ branch_name, pr_url }`
- [ ] Server uses the user's GitHub token (via `github_token_secret_id` from Supabase Vault per US-039) to:
  1. Get the repo's `default_branch` SHA
  2. Create a new branch `codelens/refactor/<issue-id>-<short-slug>` from that SHA
  3. For each `change` in the proposal, apply via the GitHub contents API (`PUT /repos/{owner}/{repo}/contents/{path}` for create/modify, `DELETE` for delete) with the proposal summary as the commit message
  4. Open a **draft** PR (`draft: true`) against `default_branch` with title `Refactor: <summary>` and body containing the rationale, risks, and a deep link back to the CodeLens issue
- [ ] On success, updates `issue_proposals` row with `status = 'applied'`, `branch_name`, `pr_url`
- [ ] If branch already exists (proposal was applied before, then user retries), endpoint returns the existing `pr_url` rather than failing
- [ ] All write actions are bound by a server-side guard: only applies if `auth.uid()` matches `issue_proposals.user_id` AND the user owns or is a team member of the repo (existing RLS-equivalent check pattern)
- [ ] Frontend `ProposalPanel` shows a success toast with the PR link on completion, and the button text changes to "View PR" linking to `pr_url`
- [ ] Errors (GitHub API rate limit, permission denied, merge conflict on apply) surface as toasts with actionable messages — never raw GitHub API errors

**Note**
> Draft, never merge-ready. The whole product position depends on the human being the one who clicks merge. Use Octokit's `octokit.rest.git.createRef`, `octokit.rest.repos.createOrUpdateFileContents` (per file), and `octokit.rest.pulls.create` with `draft: true`. Note that `createOrUpdateFileContents` doesn't accept a unified diff — you need to apply the diff server-side to the existing file content and PUT the new full content. Either reuse a Node diff library (`diff` package, `applyPatch` function) or have the AI emit full file contents alongside diffs for create/modify actions (cheaper at apply time, more tokens at generation time). Recommended: full contents in the JSON, diff in the JSON only for display. The diff is then UI-only and the apply step is straightforward `PUT`s.
>
> Slug generation: take the issue type + file basename, lowercase, hyphenate, truncate to 40 chars. E.g. `god_file` on `userController.js` → `god-file-usercontroller-js`.
>
> Failure modes worth handling explicitly: the user revoked their GitHub token (401), the user lacks write access to the repo (403), a file in the diff no longer exists (404), the branch name already exists (422). All four should map to specific user-facing messages.

---

## 🤖 EPIC: AI Repo Agent

A conversational agent that uses CodeLens's deterministic analysis as its tool surface. The model can call `get_blast_radius`, `list_issues`, `get_attack_paths`, `find_paths`, `propose_fix`, and others to reason about the whole repo in ways a generic coding assistant cannot. Replaces the current Search tab.

---

### US-067: Agent conversation persistence schema

**Labels:** `epic/agent` `database`
**Milestone:** Sprint 15 — Weeks 29–30

---

**As a** developer
**I want to** have the database tables in place to persist agent conversations and the full tool-call trace
**So that** I can resume threads across sessions and so the team can review what the agent did

**Acceptance Criteria**
- [ ] New `agent_conversations` table `{ id, repo_id, user_id, title, total_tokens, created_at, updated_at }`
- [ ] New `agent_messages` table `{ id, conversation_id, role, content_json, token_usage, created_at }`
- [ ] `role` enum: `user | assistant | tool_use | tool_result`
- [ ] `content_json` is JSONB — for `user` and `assistant` it holds `{ text }`; for `tool_use` it holds `{ tool_name, input, tool_use_id }`; for `tool_result` it holds `{ tool_use_id, output, is_error }`
- [ ] `repo_id` and `conversation_id` foreign keys with `ON DELETE CASCADE`
- [ ] RLS enabled — users access only their own conversations and messages
- [ ] Index on `agent_messages(conversation_id, created_at)` for ordered replay
- [ ] Index on `agent_conversations(user_id, repo_id, updated_at DESC)` for the sidebar list
- [ ] `updated_at` trigger on `agent_conversations` using the existing `set_updated_at()` function
- [ ] `total_tokens` updated incrementally on each assistant turn (sum of `token_usage.input + output`)
- [ ] Migration is idempotent in the same style as the existing `schema.sql`

**Note**
> Persist the full tool-call trace, not just user/assistant turns. The trace is the value — it's what makes the agent debuggable, auditable, and resumable. Keeping `content_json` polymorphic by role keeps the table schema simple; query patterns can `WHERE role = 'tool_use'` for trace inspection.
>
> Title generation is deferred to US-068 — leave `title NULL` on creation, populate from the first user message after the first assistant response.
>
> Append to `scripts/schema.sql`. The `tool_use_id` field matches Anthropic's tool-use protocol — keeping the same identifier through the trace makes replay trivial.

---

### US-068: Agent tool surface

**Labels:** `epic/agent` `epic/ai`
**Milestone:** Sprint 15 — Weeks 29–30

---

**As a** developer using the agent
**I want** Claude to be able to query CodeLens's structural analysis directly
**So that** answers are grounded in my real codebase state — graph, metrics, issues, attack paths — not just embeddings of source text

**Acceptance Criteria**
- [ ] New file `backend/src/services/agentTools.js` exports a registry of tool definitions and handlers
- [ ] Each tool exports `{ name, description, input_schema, handler(input, ctx) }` where `ctx = { repo_id, user_id, supabase }`
- [ ] Implemented tools (all read-only except the last):
  - `get_graph_overview` → counts, top 10 hubs by `incoming_count`, top 10 sinks, cycle count
  - `list_issues({ type?, severity?, file? })` → up to 50 `analysis_issues` rows; `{ truncated: true }` if more exist
  - `get_file_metrics({ path })` → `graph_nodes` row for that path
  - `get_blast_radius({ path, depth? })` → direct + transitive dependents (reuses the BFS already used by US-021)
  - `get_dependents({ path })` / `get_imports({ path })` → one-hop edges
  - `find_paths({ from_path, to_path, max_paths? })` → up to 10 graph paths between two files
  - `get_attack_paths({ source?, sink?, max_paths? })` → reuses US-047 reachability
  - `search_code({ query, top_k? })` → wraps the existing RAG retrieval, returning raw chunks (not synthesised)
  - `read_file({ path, start_line?, end_line? })` → from `file_contents` (US-043)
  - `get_vulns({ severity? })` → `dependency_manifests` joined with `vulnerability_cache`
  - `propose_fix({ issue_id })` → calls the US-063 pipeline, returns the resulting proposal summary + `proposal_id`
- [ ] All collection-returning tools cap output at 50 rows and include `{ truncated: true, total: N }` when truncated
- [ ] All tools wrapped in try/catch — failures return `{ is_error: true, message }` instead of throwing
- [ ] Each tool individually unit-tested with mocked Supabase responses
- [ ] Tool schemas are exported in Anthropic's `tools` API format ready to pass to the SDK

**Note**
> The tool surface is the product. Spend time on the descriptions — Claude picks tools based on their description text, not their name. "get_blast_radius" with a description like *"Returns the set of files that would be affected by a change to a given file. Use this to assess the impact of modifications."* is dramatically more reliable than the same tool with a one-word description.
>
> Don't dump the whole graph in `get_graph_overview` — that's how you blow context. Return summaries with hints like *"call get_dependents(path) to drill into a specific file."* The model learns to chain.
>
> `propose_fix` is the only write-side tool and the only one that consumes meaningful Claude tokens. Treat it as a sub-agent call: it streams internally but the agent tool returns only the structured summary + proposal_id once complete. The user can open the full proposal panel by clicking the proposal_id surfaced in the agent's reply.

---

### US-069: Agent loop endpoint with SSE streaming

**Labels:** `epic/agent` `epic/ai`
**Milestone:** Sprint 15 — Weeks 29–30

---

**As a** developer chatting with the agent
**I want** the backend to drive the Anthropic tool-use loop, persist the trace, and stream events to the UI
**So that** I see thinking, tool calls, and answers as they happen rather than waiting for the whole reply

**Acceptance Criteria**
- [ ] New endpoint `POST /api/repos/:repoId/agent/chat` accepting `{ conversation_id?, message }` and streaming SSE
- [ ] If `conversation_id` is omitted, creates a new `agent_conversations` row and emits a `conversation_created` event with the new id
- [ ] Loads prior `agent_messages` for the conversation and rehydrates them into the Anthropic `messages` array, preserving `tool_use` / `tool_result` pairs
- [ ] Calls `anthropic.messages.create` with `stream: true`, the full tool list from US-067, and `tool_choice: 'auto'`
- [ ] Loop terminates on `stop_reason: end_turn` or after **15 iterations** (configurable via env `AGENT_MAX_ITERATIONS`)
- [ ] Per-conversation token cap of **50 000 tokens** — if exceeded, emits a `budget_stopped` event and ends gracefully
- [ ] SSE event types emitted to client:
  - `conversation_created` — `{ conversation_id }`
  - `text_delta` — `{ delta }` (streaming assistant text)
  - `tool_use` — `{ tool_use_id, tool_name, input }` (when model requests a tool)
  - `tool_result` — `{ tool_use_id, output, is_error }` (after handler returns)
  - `finish` — `{ stop_reason, total_tokens }`
  - `error` — `{ message }` for unrecoverable errors
- [ ] All user, assistant, tool_use, and tool_result turns persisted to `agent_messages` as they happen — survives a dropped connection mid-stream
- [ ] Cancellation: client `AbortController` aborts the upstream Anthropic stream and persists what was generated so far
- [ ] Reuses `aiRateLimit` middleware (US-042) — counts against daily budget, returns 429 if exceeded before the request starts
- [ ] First user message triggers async title generation (one cheap Haiku call) once the first assistant turn completes

**Note**
> Persistence-as-you-go is the key correctness property. If the server crashes mid-loop, the conversation should be resumable from exactly where it stopped — that means each `tool_use` and `tool_result` row is written before the next Anthropic call. Use a single Supabase transaction per turn boundary.
>
> The Anthropic SDK tool-use loop is well-documented: on each response, check `stop_reason`. If `tool_use`, execute the tool(s) in parallel where safe (read-only tools can parallelise; `propose_fix` cannot), build a user-role message with `tool_result` blocks, send back. If `end_turn`, you're done. Capping at 15 iterations is generous — most conversations resolve in 2–4.
>
> Title generation: separate one-shot call to `claude-haiku-4-5-20251001` with prompt *"Summarise this question as a 4–6 word title: '{first user message}'"*. Don't block the main response on it — fire-and-forget after the first assistant turn.

---

### US-070: Agent chat UI with tool-call display

**Labels:** `epic/agent` `epic/dashboard`
**Milestone:** Sprint 15 — Weeks 29–30

---

**As a** developer using the agent
**I want** a chat interface that shows the agent's tool calls inline as they happen
**So that** I can see what the agent is actually doing — not just the final answer — and trust it because the work is visible

**Acceptance Criteria**
- [ ] The current "Search" tab is renamed to **"Agent"** in the repo top tab bar; the existing search functionality is exposed inside the agent via the `search_code` tool
- [ ] Chat surface uses three message types: `UserMessage`, `AssistantMessage` (streamed markdown with code highlights), and `ToolCallCard` (collapsible)
- [ ] Each `ToolCallCard` renders inline within the assistant turn that triggered it, with:
  - Tool name + a short human-readable verb (e.g. `get_blast_radius` → "Checking blast radius of `authController.js`…")
  - A status indicator: spinner while pending, ✓ on success, ⚠ on error
  - Collapsed by default once complete; click to expand the raw input + output JSON
- [ ] Streaming text renders progressively via `text_delta` events
- [ ] `propose_fix` results surface a `ProposalPreviewCard` with summary + a "Open full proposal" button that opens the US-064 panel
- [ ] Input is a multi-line textarea with Enter to send, Shift+Enter for newline; disabled while a turn is in progress
- [ ] Cancel button visible during streaming; click aborts the SSE
- [ ] If the response references files (via `read_file` or `search_code`), filenames in the assistant text are linkified to open the file viewer (US-037)
- [ ] Markdown supports the same syntax-highlighter theme as `SharedAnswerComponents.jsx`
- [ ] Empty state for a new conversation: short helper text + 4 suggested example questions tied to the current repo's state ("Where are the unauthenticated routes?", "Why is `userController.js` flagged as a god file?", "What would break if I removed `legacy/v1Api.js`?", "Which files are most worth writing tests for first?")

**Note**
> The tool-call display is the single thing that makes this product feel different from a chat box. Watching the agent walk *your* graph is the demo moment. Don't hide tool calls behind a single collapsed "Thinking" disclosure — each one should be visible inline, in order, so the trail of reasoning is obvious. Once complete, they collapse to a one-liner to keep the conversation readable.
>
> Tool verb mapping is a small lookup table — `{ get_blast_radius: "Checking blast radius of", list_issues: "Listing issues", ... }` keyed by tool name, with the `input.path` or relevant arg interpolated. Avoid generic verbs like "Calling tool: get_blast_radius" — that's machinery, not UX.
>
> Suggested example questions should be computed server-side based on what the repo actually has — if there are no `missing_auth` issues, don't suggest "Where are the unauthenticated routes?". `GET /api/repos/:repoId/agent/suggestions` returns 4 tailored prompts.

---

### US-071: Agent conversation history and management

**Labels:** `epic/agent` `epic/dashboard`
**Milestone:** Sprint 15 — Weeks 29–30

---

**As a** developer
**I want** a list of my past agent conversations for the current repo with the ability to resume, rename, or delete them
**So that** I can pick up an investigation where I left off and clean up clutter

**Acceptance Criteria**
- [ ] A left rail inside the Agent tab lists conversations for the current repo, sorted by `updated_at DESC`, paginated (20 per page)
- [ ] Each row shows the auto-generated `title` (or the first user message truncated to 40 chars if title is null), a relative timestamp, and a token-count badge
- [ ] Clicking a row loads the full conversation into the chat surface (calls a new endpoint `GET /api/agent/conversations/:id`)
- [ ] **New conversation** button at the top of the rail clears the chat surface; the conversation is only persisted once the first message is sent
- [ ] Hover actions on each row: **Rename** (inline editable title), **Delete** (with confirm)
- [ ] Endpoints:
  - `GET /api/repos/:repoId/agent/conversations` — list (paginated)
  - `GET /api/agent/conversations/:id` — single conversation with all messages
  - `PATCH /api/agent/conversations/:id` — update title
  - `DELETE /api/agent/conversations/:id` — delete conversation (cascades to messages)
- [ ] All endpoints enforce `user_id = auth.uid()` via RLS
- [ ] Rail is collapsible — on screens narrower than `lg`, hidden by default behind a "History" button
- [ ] Empty state ("No conversations yet — ask the agent anything") matches US-023 styling

**Note**
> This is a thin CRUD layer on the schema from US-066 — most of the work is UI polish. Reuse the pagination pattern from the Issues tab. Inline rename: editable `<input>` that swaps in on click, blurs on Enter or focus loss, optimistic update with rollback on error.
>
> Deletion is hard delete (RLS-protected) — no soft delete needed. Conversations are user-private and there's no audit requirement that prevents removal. Cascade on `agent_messages` is already in the schema.
>
> Token-count badge uses `agent_conversations.total_tokens` (maintained by US-068). Display as `1.2k` / `45k` etc. — short form.

---

## 🏷️ Suggested new GitHub labels

| Label | Color | Description |
|---|---|---|
| `epic/refactor` | `#EA580C` | AI-generated refactor proposals and PR application |
| `epic/agent` | `#0E7490` | Repo agent (Claude tool-use loop over CodeLens's analysis) |

---

## 📅 Suggested milestones

| Milestone | Weeks | Stories |
|---|---|---|
| Sprint 14 — AI Refactor Proposals | Weeks 27–28 | US-062 → US-065 |
| Sprint 15 — AI Repo Agent | Weeks 29–30 | US-066 → US-070 |

Refactor proposals ship first because US-067 exposes `propose_fix` as an agent tool — the agent inherits a working refactor pipeline rather than competing with it. The agent also benefits from having a real example of structured-AI-output design (the `Proposal` schema) before tackling the more open-ended chat surface.
