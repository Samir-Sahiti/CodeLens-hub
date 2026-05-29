# CodeLens — Next Issues: PR Review, CI, Notifications, Risk, Trends, Dep Auto-PR, Onboarding

These stories extend `issues.md` with the next wave of epics. They focus on closing the gap between CodeLens's analysis core and where developers actually work — pull requests, CI, notifications, and dashboards that show change over time. Numbering continues from US-071.

Build order rationale: **PR Review** ships first because it's the highest-leverage product surface and reuses everything that already exists (Octokit, Vault tokens, branch/diff endpoint, scanners, suppression model). **CI Check** rides alongside it since it's a thin wrapper over the same endpoints. **Notifications** and **Risk Prioritization** then turn CodeLens from a place developers visit into a tool that surfaces signal to them. **Trends** and **Dep Auto-PR** land last because they're enhancements rather than foundations. **Onboarding** is small polish that can slot in anywhere.

---

## 🔍 EPIC: PR Review Workflow

A pull-request review surface that runs CodeLens's existing deterministic scanners (SAST, secrets, missing auth, SCA) on the diff, computes blast radius for changed files, and posts findings inline on the PR. The first version is deterministic-only — AI review of the diff is a follow-on enhancement once we have telemetry on which deterministic findings users actually action.

---

### US-072: PR review persistence schema

**Labels:** `epic/pr-review` `database`
**Milestone:** Sprint 16 — Weeks 31–32

---

**As a** developer
**I want to** persist PR review results tied to a specific PR + head commit
**So that** the UI can render historical reviews, and re-pushes don't lose context from the previous review

**Acceptance Criteria**
- [ ] New `pr_reviews` table `{ id, repo_id, pr_number, pr_head_sha, pr_base_sha, user_id, status, findings_json, summary, total_findings, severity_counts, created_at, updated_at }`
- [ ] `status` enum: `pending | analyzing | ready | failed | stale`
- [ ] `severity_counts` JSONB shape `{ critical: int, high: int, medium: int, low: int }`
- [ ] `findings_json` JSONB holds the full per-file, per-line findings (same structural shape as `analysis_issues` rows so the UI can reuse `IssueCard`)
- [ ] Unique index on `(repo_id, pr_number, pr_head_sha)` — a re-push (new head_sha) creates a new review row; previous review for the PR is marked `status = 'stale'`
- [ ] New `pr_review_comments` table `{ id, review_id, github_comment_id, file_path, line_number, kind, created_at }` where `kind` is `inline | summary | review_event`
- [ ] FKs: `repo_id → repositories(id) ON DELETE CASCADE`, `review_id → pr_reviews(id) ON DELETE CASCADE`
- [ ] RLS enabled — read access via `can_access_repo` RPC (existing pattern from US-058)
- [ ] Index on `(repo_id, pr_number, created_at DESC)` for the per-PR history view
- [ ] `updated_at` trigger using existing `set_updated_at()` function
- [ ] Migration appended to `scripts/schema.sql` in the existing idempotent style

**Note**
> `findings_json` schema mirrors `analysis_issues` rows so `IssueCard` can render either source without branching: `{ id, type, severity, file_path, line_number, rule_id, message, ai_explanation?, suggested_fix? }`. The `ai_explanation` and `suggested_fix` slots stay null in v1 — they're reserved for the future "deep review" enhancement.
>
> `pr_review_comments` exists primarily for **idempotent re-pushes**. When head_sha changes, we want to resolve or update the old GitHub comments rather than litter the PR with duplicates. Storing the `github_comment_id` is what makes that possible. The `kind` discriminator separates inline review comments (per-line) from the aggregate PR summary comment and the top-level review event itself.

---

### US-073: PR review analysis pipeline

**Labels:** `epic/pr-review` `epic/ai`
**Milestone:** Sprint 16 — Weeks 31–32

---

**As a** developer who opened a PR
**I want** CodeLens to analyze the diff and surface security and structural findings
**So that** I catch problems before the PR gets reviewed by a human

**Acceptance Criteria**
- [ ] New endpoint `POST /api/repos/:repoId/pulls/:number/reviews` triggers a review run; SSE-streamed status updates
- [ ] New column `repositories.pr_review_enabled BOOLEAN DEFAULT false` — opt-in per repo
- [ ] Existing GitHub webhook (`/api/webhooks/github`) extended to handle `pull_request` events (`opened`, `synchronize`, `reopened`) — when received AND `pr_review_enabled = true`, kick off a review automatically
- [ ] Pipeline per review:
  1. Fetch PR via Octokit: head_sha, base_sha, changed files with patches
  2. For each changed file:
     - Run secret scan on added lines (reuse US-044 `secret-rules.json`)
     - Run SAST on full new file content (reuse US-046 AST rules) — only NEW findings (compare against pre-PR state from `analysis_issues`) surface in the review
     - Run auth coverage check (US-049) if file matches route patterns
     - Compute blast radius from the most recent index (note staleness if `head_sha != latest_indexed_sha`)
  3. If `package.json` / `requirements.txt` / lockfiles changed, run SCA (US-045) on the diff and surface newly-introduced vulnerable deps
  4. Aggregate findings → write `pr_reviews.findings_json`, set `status = 'ready'`
- [ ] Existing `issue_suppressions` table respected — suppressed rule/line combos do not appear in the review
- [ ] SSE event types: `analyzing_file` (per file), `finding` (per individual finding), `summary` (final counts), `done` (`{ review_id }`), `error`
- [ ] Re-pushes: the previous `ready` review for the PR is marked `stale` before the new analysis starts
- [ ] Review pipeline is **deterministic-only** in v1 — no Claude calls, no AI tokens spent. The "Generate fix" CTA per finding (US-074) calls the existing US-063 proposal pipeline on demand.
- [ ] Emits a `pr_review.ready` notification event (consumed by US-076) when complete

**Note**
> The "only NEW findings" rule matters. If the PR touches a file that already has 50 pre-existing SAST findings, we don't want to dump all 50 into the PR — only ones introduced by the diff. Implement this by querying `analysis_issues` for the file (pre-PR state) and excluding any finding whose `(rule_id, line_number)` already exists. For added lines this is straightforward; for modified lines the line number may have shifted, so match on `(rule_id, content_hash_of_surrounding_3_lines)` as a fallback.
>
> Don't re-index the head SHA inside this pipeline — that would balloon latency. Use the most recent index as approximate context and surface a "Index is N commits behind this PR" banner in the UI. The blast-radius numbers stay useful even if slightly stale.
>
> For very large PRs (> 50 files changed), cap analysis at the 50 files with the most additions and emit a `truncated` event. Saves cost on monster PRs that nobody can review meaningfully anyway.

---

### US-074: Post PR findings as GitHub comments

**Labels:** `epic/pr-review` `epic/infra`
**Milestone:** Sprint 16 — Weeks 31–32

---

**As a** developer reviewing a PR
**I want** CodeLens findings to appear inline as PR review comments
**So that** my team sees them in the natural review surface without having to leave GitHub

**Acceptance Criteria**
- [ ] New endpoint `POST /api/repos/:repoId/reviews/:reviewId/publish` posts the review to GitHub
- [ ] Uses the repo owner's GitHub token from Supabase Vault (US-039 pattern) with `pull_request:write` scope
- [ ] Posts a single `pulls.createReview` with:
  - `event`: `'COMMENT'` by default, `'REQUEST_CHANGES'` if any finding is `critical` or `high` (configurable per-repo via `repositories.pr_review_block_on_severity`)
  - `body`: aggregate summary with severity counts, a markdown table of findings, and a deep link to the full review in CodeLens
  - `comments[]`: one entry per finding with a line reference (path + line + body containing rule_id, severity badge, message, and a CodeLens deep link)
- [ ] Each posted comment's `github_comment_id` saved to `pr_review_comments` with its `kind`
- [ ] Findings with no line reference (file-level issues like missing auth on a route file) go into the summary body, not inline
- [ ] Idempotent re-publish on a re-push:
  - Old review's inline comments queried from `pr_review_comments`
  - For each, attempt `pulls.updateReviewComment` if the file/line still exists in the new diff, else `pulls.deleteReviewComment`
  - Old summary comment marked outdated via edit (prepend "**[Outdated — see updated review below]**")
- [ ] Auto-publish toggle on `pr_reviews` table — `repositories.pr_review_auto_publish BOOLEAN DEFAULT true`. When true, US-072 completion triggers publish automatically.
- [ ] Per-finding "View in CodeLens" link in each comment body
- [ ] Failure modes surface as toasts in the CodeLens UI: 401 (token revoked → prompt re-auth), 403 (no write access → instructions), 422 (validation error → log + retry once with backoff)

**Note**
> Use `octokit.rest.pulls.createReview` to post all comments in a single API call rather than `pulls.createReviewComment` per finding — atomic, fewer rate-limit hits, and the comments group under a single review header in the GitHub UI.
>
> The `REQUEST_CHANGES` vs `COMMENT` distinction is sensitive. Some teams will hate having their PRs blocked by a third-party tool; others will want exactly that. Make it a setting and default to `COMMENT` for the first ship — `REQUEST_CHANGES` can be enabled per-repo by a team admin. Same applies to `pr_review_block_on_severity` (default `'critical'` only).
>
> The "auto-publish" toggle is the key UX call. Many tools (CodeRabbit, Greptile) auto-post on every PR by default. We default to true because it's the killer feature, but the off switch needs to be obvious — a banner on the PR list page when disabled.

---

### US-075: PR review viewer UI in CodeLens

**Labels:** `epic/pr-review` `epic/dashboard`
**Milestone:** Sprint 16 — Weeks 31–32

---

**As a** developer
**I want** a dedicated UI in CodeLens for browsing PR reviews
**So that** I can see the full context (blast radius, fix proposals, suppression history) that doesn't fit in a GitHub comment

**Acceptance Criteria**
- [ ] New "Pull Requests" tab in `RepoView` between "Dependencies" and "Tours"
- [ ] Tab lists recent PRs with columns: `#`, title, author avatar, head_sha (short), review status badge (`ready` / `analyzing` / `failed` / `not analyzed` / `stale`), severity counts, last analyzed time
- [ ] Default sort: PRs with `critical/high` findings first, then by `updated_at DESC`
- [ ] Filters: open vs. all, has findings vs. clean, by author
- [ ] Click a PR row → opens a review detail view (full-page, not slide-in — too much content for a panel):
  - Header: PR title + link to GitHub, head_sha, base_sha, "Re-run review" button, stale-index banner if applicable
  - Aggregate summary: severity breakdown chart, link to GitHub review
  - Findings grouped by severity, then by file
  - Each finding card matches the existing `IssueCard` pattern: rule_id, message, file:line, "Generate fix" CTA (opens US-064 panel), "Suppress" action (writes to `issue_suppressions`)
  - "View on GitHub" link per finding (uses stored `github_comment_id`)
- [ ] PR list polls `/api/repos/:repoId/pulls` every 30s when the tab is open (covers webhook race conditions)
- [ ] Endpoints:
  - `GET /api/repos/:repoId/pulls` — list PRs with their latest review
  - `GET /api/repos/:repoId/pulls/:number/reviews` — list reviews for a PR (history including stale ones)
  - `GET /api/reviews/:reviewId` — full review detail
- [ ] Empty state: "PR review isn't enabled for this repo. [Enable]" — primary CTA toggles `repositories.pr_review_enabled`

**Note**
> Reuse `IssueCard` from `IssuesPanel` — the findings shape is the same. The only new component is `PRListItem` for the table rows and a small `SeverityBreakdown` bar chart (5 lines of Tailwind).
>
> The full-page detail view is deliberately not a slide-in panel — there's too much content (per-file groupings, fix proposals, suppression history) and users will want to deep-link to specific reviews from notifications and from GitHub comments.
>
> Don't build a PR-list-across-all-repos view yet — keep it scoped to the current repo. Cross-repo PR dashboards are an org-view feature (separate epic, eventually).

---

## 🤖 EPIC: CI Status Check

A GitHub Action that calls CodeLens's PR review endpoints from inside CI and reports the result as a status check. Turns CodeLens from advisory into a guardrail.

---

### US-076: GitHub Action and PR status check

**Labels:** `epic/pr-review` `epic/infra`
**Milestone:** Sprint 16 — Weeks 31–32

---

**As a** team lead
**I want** CodeLens findings to appear as a required status check on PRs
**So that** PRs with critical findings can't be merged until they're addressed (or explicitly overridden)

**Acceptance Criteria**
- [ ] New action published to `Samir-Sahiti/codelens-action` (or under `.github/actions/codelens-review/` in the main repo for v1)
- [ ] Action accepts inputs: `repo_id` (CodeLens repo UUID), `codelens_api_token` (secret), `fail_on_severity` (default `critical,high`), `wait_timeout_seconds` (default 300)
- [ ] Action behaviour:
  1. POST to new endpoint `POST /api/repos/:repoId/pulls/:number/reviews/ci-check` with the PR number from `github.event.pull_request.number`
  2. Endpoint blocks until the latest review for the PR's head_sha is `ready` (or returns early if already ready); 5-minute timeout
  3. Endpoint returns `{ status: 'pass' | 'fail', severity_counts, summary_markdown, codelens_url }` based on whether any finding's severity is in `fail_on_severity`
  4. Action writes a check run via the GitHub checks API: `status: completed`, `conclusion: success | failure`, `output.title`, `output.summary` (the `summary_markdown` returned)
- [ ] New auth path: per-repo CodeLens API tokens (separate table `repo_api_tokens { id, repo_id, token_hash, name, created_by, created_at, last_used_at, revoked_at }`) — generated from the repo settings UI, used only for CI access, scoped to the single repo
- [ ] Token generation UI: "Settings" → "CI Integration" → "Generate token" (show once, copy to clipboard, then hash-only stored)
- [ ] Token authentication middleware that accepts `Authorization: Bearer codelens_pat_<token>` and resolves to `(repo_id, scope: 'ci_check')`
- [ ] Action documentation in `docs/ci-integration.md` with a copy-paste workflow YAML example
- [ ] Action published with semver tag (`v1.0.0`) and `v1` floating major tag per GitHub Actions convention

**Note**
> The action itself is ~50 lines of TypeScript using `@actions/core` and `@actions/github`. The interesting work is server-side: a new per-repo API token type that can be safely shared with CI without granting access to other repos or to write actions.
>
> Token hashing: use the existing pattern for webhook secrets (HMAC with a server secret) or bcrypt. Don't store tokens in plaintext, ever — even in Vault — because CI tokens need to be matched on every request and that's a perf hit. Hash-and-compare is the right call.
>
> `fail_on_severity` defaults to `critical,high` to match the publish-as-REQUEST_CHANGES default from US-073. Keep these aligned: if the user changed the PR-review settings, they probably want CI to follow.
>
> v1 ships the action source under `.github/actions/codelens-review/` in the main repo. Moving it to a dedicated `codelens-action` repo (so external users can `uses: codelens/codelens-action@v1`) is a small migration we can do when we open-source it.

---

## 🔔 EPIC: Notifications

Surfaces signal to users without making them open the app. In-app feed first (free), email digest second (opt-in), Slack and webhook as future enhancements.

---

### US-077: Notification schema, event emission, and in-app feed

**Labels:** `epic/notifications` `database` `epic/dashboard`
**Milestone:** Sprint 17 — Weeks 33–34

---

**As a** developer using CodeLens
**I want** to see what's happened across my repos without opening each tab
**So that** I can catch new issues, completed indexes, and team activity at a glance

**Acceptance Criteria**
- [ ] New `notifications` table `{ id, user_id, repo_id, type, severity, payload_json, link_url, read_at, created_at }`
- [ ] `type` enum: `new_critical_issue | new_vulnerability | index_ready | index_failed | pr_review_ready | proposal_shared | tour_shared | webhook_paused`
- [ ] `severity` enum: `info | warning | critical`
- [ ] `payload_json` JSONB — type-specific structured data so the UI can render rich cards (e.g. for `new_critical_issue`: `{ issue_id, file_path, rule_id, message }`)
- [ ] `link_url` is a deep link into the app (e.g. `/repos/:id/issues?issue=:issueId`)
- [ ] RLS: user_id-scoped read/write
- [ ] Index on `(user_id, read_at, created_at DESC)` for the unread-count badge and ordered feed
- [ ] Index on `(user_id, repo_id, type, created_at DESC)` for de-duplication queries
- [ ] New module `backend/src/services/notifications.js` exports `enqueueNotification({ user_ids, repo_id, type, severity, payload, link_url })`
- [ ] Event emission wired into:
  - Indexer pipeline → `index_ready` (recipient: repo owner + team members), `index_failed` (owner only)
  - Indexer issue-detection step → `new_critical_issue` (only for newly-introduced issues; compare to previous index, dedupe per `(file_path, rule_id)`)
  - SCA scanner → `new_vulnerability` when a manifest scan reveals a CVE not seen in the previous scan
  - US-072 PR review pipeline → `pr_review_ready` with finding counts in payload
  - US-061 tour fork → `tour_shared` to the original tour's author when someone forks it
- [ ] In-app feed UI: bell icon in the top nav, with an unread-count badge (`99+` cap)
- [ ] Click the bell → dropdown panel showing latest 20 notifications, grouped by day, with type-specific icons
- [ ] Each notification row: severity dot, icon, repo name pill, primary text, relative timestamp, click → navigate to `link_url` AND mark read
- [ ] "Mark all as read" button at the top of the dropdown
- [ ] Full feed page (`/notifications`) for older notifications, paginated 50 per page
- [ ] Polling: dropdown refetches every 30s while open; bell badge polls every 60s when the app is in foreground
- [ ] Endpoints:
  - `GET /api/notifications?limit&before` — list with cursor pagination
  - `POST /api/notifications/:id/read` — mark single read
  - `POST /api/notifications/mark-all-read` — mark all read for the current user
  - `GET /api/notifications/unread-count` — for the badge

**Note**
> De-duplication on `new_critical_issue` is essential. Without it, re-indexing a repo with 10 pre-existing critical issues would spam 10 notifications. The query is: "for this repo, this user, this issue's `(file_path, rule_id)`, has a notification been emitted in the last 30 days?" If yes, skip.
>
> Don't build websockets for v1. Polling every 30s for the open dropdown and every 60s for the badge is cheap (cursor-paginated query on an indexed table) and avoids the complexity of socket reconnection logic. We can swap to Supabase Realtime later if engagement justifies it.
>
> The `webhook_paused` type is for the case where GitHub disables a webhook after too many delivery failures (real edge case in production). When detected, the user gets a notification linking to the repo settings to re-enable it. Useful failure-mode coverage that other tools handle poorly.

---

### US-078: Email digest and per-user preferences

**Labels:** `epic/notifications` `epic/infra`
**Milestone:** Sprint 17 — Weeks 33–34

---

**As a** developer who doesn't keep CodeLens open all day
**I want** to receive an email digest with the day's notifications
**So that** I don't miss critical security findings or vulnerability disclosures

**Acceptance Criteria**
- [ ] New `notification_preferences` table `{ user_id PRIMARY KEY, in_app_enabled BOOLEAN DEFAULT true, email_enabled BOOLEAN DEFAULT false, email_digest_hour INT DEFAULT 9, email_immediate_critical BOOLEAN DEFAULT true, per_type_json JSONB, timezone TEXT DEFAULT 'UTC' }`
- [ ] `per_type_json` shape `{ new_critical_issue: { in_app: true, email: true }, ... }` — defaults baked in code, override per-user
- [ ] Email delivery uses Resend (env-configured `RESEND_API_KEY`); pluggable provider interface so we can swap later
- [ ] Two delivery modes:
  - **Immediate**: triggered on `notifications.severity = 'critical'` insert when `email_immediate_critical = true`
  - **Daily digest**: cron-fired at the user's `email_digest_hour` (in their `timezone`), collects unread notifications from the prior 24h
- [ ] Digest email template: HTML + plaintext fallback, mobile-responsive, branded header, list of notifications grouped by repo, single "Open CodeLens" CTA, footer with unsubscribe link
- [ ] Unsubscribe link uses signed JWT — clicking sets `email_enabled = false` without requiring login
- [ ] Skip email if user has zero unread notifications in the digest window (no empty emails)
- [ ] New settings page at `/settings/notifications` with toggles for each type × channel matrix
- [ ] Default `email_enabled = false` — explicit opt-in only (no surprise emails on rollout)
- [ ] Endpoints:
  - `GET /api/preferences/notifications`
  - `PATCH /api/preferences/notifications`
- [ ] Bounce/complaint handling: webhook from Resend updates a `notification_email_status` column; after 2 hard bounces, auto-disable email and emit an in-app notification

**Note**
> Cron implementation: Supabase doesn't have native scheduled functions, so use `pg_cron` (available on Supabase) for the digest job — runs hourly, picks up users whose local hour matches `email_digest_hour`. Alternative: a Render cron job that hits an internal API endpoint. Either works; `pg_cron` is fewer moving parts.
>
> Slack integration is explicitly out of scope for v1. Add it as US-???? when we have email working and demand justifies it. The `per_type_json` schema accommodates new channels without migration — just add `{ slack: true }` per type.
>
> Resend was chosen for setup speed (no DNS verification dance for first emails) and decent free tier. Postmark or SendGrid are equally fine — the provider interface should be a single `sendEmail({ to, subject, html, text })` function.

---

## 🎯 EPIC: Risk-Scored Prioritization

CodeLens already computes severity, blast radius, churn, complexity, and incoming counts. Combining them into a single risk score and surfacing "what to fix first" turns a flat issue list into a triage queue.

---

### US-079: Composite risk score and risk-sorted surfaces

**Labels:** `epic/analytics` `epic/dashboard`
**Milestone:** Sprint 17 — Weeks 33–34

---

**As a** developer with hundreds of issues in my repo
**I want** to see which ones to fix first, ranked by real impact
**So that** I'm not wading through a flat list trying to guess what matters

**Acceptance Criteria**
- [ ] New column `analysis_issues.risk_score FLOAT` populated during the indexing pipeline
- [ ] Risk score formula:
  ```
  risk_score = severity_weight × blast_factor × churn_factor

  where:
    severity_weight  = { critical: 4, high: 3, medium: 2, low: 1 }
    blast_factor     = 1 + log10(1 + transitive_dependents_count)   capped at 3
    churn_factor     = 1 + (commits_in_last_30d / median_repo_commits_30d)  capped at 2
  ```
- [ ] `transitive_dependents_count` reuses the BFS already implemented for US-021
- [ ] `commits_in_last_30d` per-file pulled from US-???/churn data (`churn_metrics` table from US-014)
- [ ] Computed during indexing in a single pass over `analysis_issues`, written via bulk UPDATE
- [ ] New index on `analysis_issues(repo_id, risk_score DESC NULLS LAST)` for fast "top risks" queries
- [ ] `IssuesPanel`:
  - New "Sort" dropdown: `Risk (default) | Severity | File | Most recent`
  - Risk-sorted view shows `risk_score` as a small numeric badge on each card (e.g. `Risk 7.4`)
  - "What is this?" tooltip on the badge explains the formula
- [ ] Dashboard:
  - New "Top Risks" widget showing the top 5 highest-risk issues across all repos the user has access to (own + team-shared)
  - Each row: severity badge, repo name, file_path, message, risk score, click → opens the issue in the relevant repo
- [ ] Agent tool `list_issues` (US-067) extended:
  - `input_schema` accepts `sort_by: 'risk' | 'severity' | 'recent'`, default `risk`
  - Each returned issue includes `risk_score` and its three component values (so the model can explain ranking)
- [ ] PR review findings (US-072) also computed and sorted by risk

**Note**
> Calibrating the formula will take iteration. Start with the formula above; once we have US-079 (telemetry on which issues get proposals generated / PRs opened from them), tune the weights. The `risk_score_v` column would let us version the formula and compare cohorts.
>
> The `churn_factor` requires `churn_metrics` — that table exists from US-014. If a file has no churn data (newly indexed repo, no git history), `churn_factor` defaults to 1.
>
> Don't normalize the risk score to a 0-100 scale. Raw numbers (range roughly 1-24) make the badge informative — "Risk 18" vs "Risk 4" tells a story that "Risk 73 / 100" doesn't.
>
> Cross-repo "Top Risks" on the Dashboard is the demo moment for this story. It's the first time CodeLens shows leverage across repos rather than just within one — a tiny preview of the eventual multi-repo view.

---

## 📖 EPIC: Onboarding Polish

The existing static onboarding guide is outdated. This story brings it current with the new tabs and ships a polished, in-app version. Adaptive onboarding (the dynamic, repo-aware guide idea) is deferred to a later epic.

---

### US-080: Finalize the static onboarding guide

**Labels:** `epic/dashboard` `documentation`
**Milestone:** Sprint 17 — Weeks 33–34

---

**As a** new CodeLens user
**I want** a clear, current walkthrough of the app's features
**So that** I know what each tab does and how to get value out of the product

**Acceptance Criteria**
- [ ] Existing onboarding guide component located and audited (likely `frontend/src/components/OnboardingGuide.jsx` or `pages/Onboarding.jsx`)
- [ ] Content moved into a single source file `frontend/src/content/onboarding-guide.md` — sections per tab/feature, parsed at build time
- [ ] Sections, in order:
  1. **Connecting a repo** (GitHub OAuth + ZIP upload)
  2. **The dependency graph** (force layout, clustering, blast radius, attack-surface overlay)
  3. **Issues panel** (issue types, suppressions, risk sort once US-078 ships, "Generate fix")
  4. **Metrics tab** (complexity, churn, line counts)
  5. **Dependencies tab** (SCA, vulnerable packages, batched fix proposals once US-083 ships)
  6. **Tours** (creating, forking, sharing)
  7. **Pull Requests tab** (once US-074 ships — copy-stub for the section now, fill on ship)
  8. **Agent / Search tab** (current search behaviour now, swap to agent copy on US-069 ship)
  9. **Settings** (webhook auto-sync, team membership, notification preferences, CI integration)
- [ ] Each section: short paragraph (under 100 words), one annotated screenshot, a "Try it" link that deep-links into a real tab in the user's first repo (or a demo repo if none connected)
- [ ] Persistent "?" icon top-right in the main nav opens the guide as a right-side slide-in panel
- [ ] First-run trigger: open the guide automatically on first successful index when `profiles.onboarding_seen IS NULL`; sets `onboarding_seen = NOW()` on first close
- [ ] Search within the guide (client-side fuzzy match on section titles + body) — small `<input>` at the top of the panel
- [ ] Deep-link support: `?guide=section-slug` opens the guide and scrolls to that section
- [ ] Mobile-responsive: panel becomes full-screen below `md` breakpoint
- [ ] Update `README.md` "Features" section to match the live guide section list

**Note**
> Single markdown source = updates without a rebuild of the rest of the app. Use `react-markdown` (likely already a dep for assistant messages); a single component renders the markdown plus per-section CTAs from a small frontmatter block.
>
> Screenshots are the boring part that makes the guide actually useful. Use the latest CI-built version of the app, capture at 2× density for retina, and store under `frontend/public/onboarding/`. If we're worried about screenshots going stale fast, defer that to a separate cleanup pass — text-only guide is still a huge improvement over the current state.
>
> First-run behaviour intentionally fires after the first index completes, not on first login. New users who connect a repo and watch it index for the first time are at peak engagement; that's when the guide is most useful. Opening it on the empty dashboard before they've connected anything is noise.
>
> Sections 7 and 8 ship with stub copy now and get filled in by the respective epics when they land. Easier than coming back later to insert new sections.

---

## 📈 EPIC: Trends

Today every CodeLens screen is a snapshot. Snapshotting daily lets the product show change over time — the metric every engineering manager wants.

---

### US-081: Daily metrics snapshot table and rollup job

**Labels:** `epic/analytics` `database`
**Milestone:** Sprint 18 — Weeks 35–36

---

**As a** developer
**I want** CodeLens to record a daily snapshot of my repo's structural health
**So that** trend views can show how my codebase has changed over time

**Acceptance Criteria**
- [ ] New `repo_metrics_daily` table `{ id, repo_id, snapshot_date DATE, file_count, total_loc, avg_complexity, max_complexity, issue_counts_json, vulnerability_counts_json, dependency_counts_json, top_risks_json, created_at }`
- [ ] `issue_counts_json` shape `{ by_type: { god_file: int, circular_dependency: int, ... }, by_severity: { critical: int, high: int, ... } }`
- [ ] `vulnerability_counts_json` shape `{ by_severity: { critical: int, ... }, by_package: [{ name, severity, count }] }`
- [ ] `top_risks_json` — top 10 highest `risk_score` issues at snapshot time (denormalized for fast trend queries without joining `analysis_issues`)
- [ ] Unique index on `(repo_id, snapshot_date)` — UPSERT semantics; re-running the job is idempotent
- [ ] Index on `(repo_id, snapshot_date DESC)` for trend queries
- [ ] FK: `repo_id → repositories(id) ON DELETE CASCADE`
- [ ] New job `scripts/snapshot-daily.js` runs nightly at 03:00 UTC
- [ ] Job iterates all repos with `status = 'ready'` and writes a row per repo
- [ ] Aggregations computed via SQL `SELECT COUNT(*) FILTER (WHERE ...) AS critical_count, ...` in a single query per repo
- [ ] Snapshot also written immediately after a successful re-index so that the "today" data point is fresh (UPSERT on `(repo_id, snapshot_date)`)
- [ ] Retention: keep all snapshots — they're small (~500 bytes each), and `90d × 1000 repos = 45MB` is nothing
- [ ] Cron registered via `pg_cron` if available, otherwise a Render scheduled job hitting `POST /api/internal/snapshot-daily` (with a server-secret header)

**Note**
> The snapshot is denormalized on purpose. Even though every count could be computed on-the-fly by joining `analysis_issues`, doing that across 90 days of trend lines for 10 repos is slow. Pre-aggregating into JSONB gives single-row reads per data point.
>
> `pg_cron` is the cleaner cron option on Supabase — it lives inside Postgres and survives DB restarts. The Render-cron fallback exists in case Supabase ever changes their pg_cron policy.
>
> Don't backfill historical data. Trend lines simply start from the day this story ships. Telling users "data from 2026-MM-DD onwards" in the UI is honest and avoids the rabbit hole of trying to reconstruct historical state from git history (which we don't have meaningful state for anyway).

---

### US-082: Trends tab UI

**Labels:** `epic/analytics` `epic/dashboard`
**Milestone:** Sprint 18 — Weeks 35–36

---

**As a** developer or engineering manager
**I want** to see how my repo's health is changing over time
**So that** I can spot improving or worsening trends and report progress to my team

**Acceptance Criteria**
- [ ] New "Trends" tab in `RepoView` (after Metrics)
- [ ] Default range: last 30 days; selector for `7d | 30d | 90d | All`
- [ ] Charts (line charts, one per metric):
  - Total issues by severity (stacked area)
  - Vulnerability count by severity (stacked area)
  - Average complexity (single line)
  - File count (single line)
  - Total LOC (single line)
- [ ] Headline metric strip across the top: 4 KPIs each showing current value + delta vs. period start (e.g. "Critical issues: 3 ↑2 vs. 30d ago")
- [ ] Delta direction colored: red for "worse" (more issues, more vulns, more complexity), green for "better"
- [ ] Hover on any chart point: tooltip with date + value + delta from previous data point
- [ ] If less than 7 days of snapshots exist, show a helper banner: "Trends fill in as your repo is re-indexed daily. Come back in a week for a full picture."
- [ ] Endpoint `GET /api/repos/:repoId/trends?range=30d` returns `{ snapshots: [...], summary: { current, period_start, delta } }`
- [ ] Charts use Recharts (smaller bundle than Chart.js, more idiomatic React; D3 is overkill for time series)
- [ ] Export button: download the visible chart data as CSV

**Note**
> Recharts is the right choice here even though D3 is already a dep — D3 forces you to write a lot of scaffolding for time-series charts that Recharts handles declaratively. The bundle hit is minor (Recharts ~ 95kb gzipped) and it interops fine with the existing D3-based graph code.
>
> The "delta vs. period start" framing matters more than the absolute charts. Most users will glance at the KPI strip and never expand a chart. Get the KPI deltas right (with appropriate "no data" handling) and the rest is gravy.
>
> Export-as-CSV is a small ask that engineering managers love — they want to drop the numbers into a slide deck. Five lines of code with `papaparse`.

---

## 🛡️ EPIC: Vulnerable Dependency Auto-PR

Today the `vulnerable_dependency` propose_fix path generates a diff via Claude but doesn't regenerate the lockfile, so the resulting PR is broken. This epic adds deterministic resolve-and-relock, then layers batching and blast-radius context on top.

---

### US-083: npm dependency-fixer service

**Labels:** `epic/refactor` `epic/security` `epic/infra`
**Milestone:** Sprint 18 — Weeks 35–36

---

**As a** developer
**I want** CodeLens to update both `package.json` AND `package-lock.json` when it proposes a dep upgrade
**So that** the resulting PR actually installs cleanly without me having to run `npm install` locally first

**Acceptance Criteria**
- [ ] New service `backend/src/services/dependencyFixer.js`
- [ ] Function signature `fixNpmDependency({ manifest_content, lockfile_content, lockfile_format, package_name, target_version, strategy }) → Promise<{ ok: true, new_manifest, new_lockfile, applied_changes } | { ok: false, reason }>`
- [ ] `lockfile_format`: `'npm' | 'yarn' | 'pnpm'`
- [ ] `strategy`: `'minimum_safe' | 'latest_safe'` — minimum is the smallest version that resolves the CVE, latest is the latest non-breaking version
- [ ] npm path:
  - Uses `@npmcli/arborist` library — load the project into an in-memory `Arborist` instance using the provided manifest + lockfile as virtual files, edit the dependency, call `arborist.reify({ dryRun: false, save: true, audit: false })`, serialize the updated manifest + lockfile
  - No filesystem writes — all in-memory via Arborist's virtual project APIs
  - For transitive vulnerabilities (vulnerable package isn't a direct dep), use npm `overrides` field instead of trying to update a sub-dep directly
- [ ] yarn path:
  - Uses `@yarnpkg/lockfile` to parse, edit, and re-serialize
  - Falls back to error `{ ok: false, reason: 'yarn_complex_resolution' }` if the upgrade requires re-resolving the tree (yarn classic doesn't expose a virtual reify equivalent the way npm does)
- [ ] pnpm path: stub for v1, returns `{ ok: false, reason: 'pnpm_not_yet_supported' }`
- [ ] `applied_changes` shape: `[{ package, from, to, kind: 'direct' | 'transitive' | 'override' }]` — used by the PR body in US-083
- [ ] Unit tests cover:
  - Direct dep upgrade with no transitive impact
  - Direct dep upgrade that requires multiple sub-dep updates
  - Transitive vuln resolved via `overrides`
  - Major version bump that breaks peer deps → `{ ok: false }`
  - Malformed manifest input → `{ ok: false, reason }`
- [ ] No shell-out anywhere — pure library calls so we don't need a sandboxed container
- [ ] Returns within 10 seconds for typical projects; reject with `{ ok: false, reason: 'timeout' }` after 30s

**Note**
> `@npmcli/arborist` is what `npm` itself uses internally for dependency resolution. The library API is undocumented in spots but well-supported — search GitHub for "arborist reify" for real-world examples. The key trick is constructing the `Arborist` with `path` pointing to a virtual fs (use `memfs` or write to a tmpdir and clean up).
>
> Updating the manifest first, then calling `reify`, is the right sequence. `reify` reads the manifest, computes the ideal tree, writes the lockfile. Don't try to edit the lockfile directly — that's what makes other tools' auto-PRs flaky.
>
> pip / cargo / bundler all need real sandbox containers because their resolvers don't have nice in-process libraries. Defer those to a follow-on once npm is proven. ~70% of CodeLens users are on JS/TS based on the language coverage list, so npm-only is acceptable for v1.

---

### US-084: Vulnerable-dependency proposals use auto-PR with batching

**Labels:** `epic/refactor` `epic/security`
**Milestone:** Sprint 18 — Weeks 35–36

---

**As a** developer
**I want** CodeLens to open a single PR fixing multiple vulnerable npm dependencies at once, with blast-radius context
**So that** I have one batched PR to review rather than seven (and I can see exactly what each upgrade touches)

**Acceptance Criteria**
- [ ] US-063 `vulnerable_dependency` branch refactored to skip Claude and call `dependencyFixer` (US-082) directly for the "simple bump" case
- [ ] Claude only invoked when:
  - The package has been deprecated and a replacement is needed (different package name)
  - The fix version is a major bump and Claude is asked to scan call sites for breaking-change risk (returns risk notes in `proposal.risks`)
- [ ] New endpoint `POST /api/repos/:repoId/dependencies/batch-proposal` accepting `{ vulnerability_ids: [] }` and returning a single proposal containing all manifest + lockfile changes
- [ ] Batch proposal generation:
  - Group vulnerabilities by manifest file
  - Apply each fix sequentially to the same in-memory manifest via `dependencyFixer` (chained calls — each takes the output of the prior)
  - On any failure, return the partial proposal with successful fixes + a `failed_fixes` list with reasons
- [ ] PR body markdown includes:
  - Header summary: "Fixes N vulnerabilities (X critical, Y high, Z medium) across M packages"
  - Per-package table: package name, old version, new version, kind (direct/transitive/override), CVE IDs with links to OSV.dev, severity
  - Blast-radius callout per package: "Used by N files including \[link list of top 3\]" — computed by querying `code_chunks` or `graph_edges` for imports matching the package name root (for JS: `import ... from 'package'` or `require('package')`)
  - Risks list from Claude (only if Claude was invoked) — empty section omitted if not
  - Footer: deep link to the CodeLens issue list filtered to vulnerable deps
- [ ] New settings columns on `repositories`:
  - `dependency_update_strategy TEXT DEFAULT 'minimum_safe'` — `'minimum_safe' | 'latest_safe'`
  - `dependency_batch_threshold INT DEFAULT 3` — auto-batch if N+ vulns are open
  - `dependency_auto_pr_enabled BOOLEAN DEFAULT false` — when true, the SCA scanner completion automatically opens a batched PR if `batch_threshold` is met
- [ ] When auto-PR is enabled and conditions are met, the indexer's SCA step calls the batch-proposal endpoint and then immediately calls the US-065 apply-via-PR endpoint
- [ ] PR labeled `dependencies` and `security` via GitHub labels API
- [ ] PR title format: `Fix N vulnerable dependencies` (singular `Fix 1 vulnerable dependency` if count is 1)
- [ ] Idempotency: if a PR already exists for the same `(repo, list_of_vulnerability_ids)` set, return the existing PR URL rather than opening a new one
- [ ] Per-repo "Vulnerable dependencies" section gets a "Open batched fix PR" button that triggers the flow manually for users who don't want auto-PR

**Note**
> The blast-radius callout is what makes this PR meaningfully better than Dependabot. Dependabot says "lodash bumped from 4.17.20 to 4.17.21." We say "lodash bumped from 4.17.20 to 4.17.21, used by 23 files including `userController.js` (god file) and `authMiddleware.js`." That's the differentiator — and it's almost free given the data we already have.
>
> Computing per-package blast radius needs a small new query: `SELECT file_path FROM graph_edges WHERE to_path LIKE '%/node_modules/<package>/%' OR to_path LIKE '<package>'`. Tree-sitter import resolution doesn't perfectly distinguish package imports from local ones in every language, but for npm packages the heuristic is reliable enough. Cache results per `(repo, package)` for 24h.
>
> Auto-PR (`dependency_auto_pr_enabled`) is the boldest setting in this story and the one most likely to cause complaints if it's wrong. Default off, and require an explicit toggle in repo settings to turn on. Once a user opts in, the magic of "wake up to a fix PR waiting" is high.
>
> Idempotency is non-obvious here. The "same set of vulnerability_ids" comparison means a re-scan that finds the same vulns shouldn't re-open. But a re-scan that finds the same vulns *plus a new one* SHOULD open a fresh PR with the union (and close the old one). That logic belongs in the batch-proposal endpoint, not the indexer.

---

## 🏷️ Suggested new GitHub labels

| Label | Color | Description |
|---|---|---|
| `epic/pr-review` | `#7C3AED` | Pull-request review surface (deterministic + GitHub integration) |
| `epic/notifications` | `#0891B2` | In-app feed, email digest, per-user preferences |
| `epic/analytics` | `#16A34A` | Risk scoring, trend snapshots, dashboards |

---

## 📅 Suggested milestones

| Milestone | Weeks | Stories |
|---|---|---|
| Sprint 16 — PR Review & CI | Weeks 31–32 | US-071 → US-075 |
| Sprint 17 — Notifications, Risk & Onboarding | Weeks 33–34 | US-076 → US-079 |
| Sprint 18 — Trends & Dep Auto-PR | Weeks 35–36 | US-080 → US-083 |

**Why this order:**
- **PR Review + CI** ship together because the CI status check is a thin wrapper over the same endpoints — splitting them across sprints means CI sits unused for two weeks.
- **Notifications + Risk + Onboarding** in Sprint 17: notifications need somewhere meaningful to surface, risk scoring gives them the "what's actually important" filter, and onboarding gets the new PR/notification surfaces explained as they ship.
- **Trends + Dep Auto-PR** last because both are pure additive value rather than foundational. Trends depends on `risk_score` being live (so top-risks snapshots are populated correctly), and Dep Auto-PR refines an existing flow rather than introducing a new one.

The PR Review epic is the highest-leverage individual ship in this set — it's the moment CodeLens stops being something developers visit and starts being something that shows up in their existing workflow. If priorities need to shift, push notifications later before you push PR Review later.
