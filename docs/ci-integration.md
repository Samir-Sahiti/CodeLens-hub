# CodeLens CI Integration (US-076)

Run CodeLens's deterministic PR review from inside CI and surface the result as a
GitHub status check. PRs with `critical`/`high` findings can then be blocked via a
required check + branch protection.

## 1. Generate a CI token

In CodeLens: **Repo → Settings → CI Integration → Generate token**. The token
(`codelens_pat_…`) is shown **once** — copy it immediately. It is scoped to that one
repository and can only call the CI-check endpoint.

Store it as a repository **Actions secret**, e.g. `CODELENS_API_TOKEN`.

You'll also need your **CodeLens repo UUID** (shown in the same settings page / repo URL).

## 2. Add the workflow

For v1 the action ships inside this repo at `.github/actions/codelens-review/`, so
reference it with a local path. (Once published to `codelens/codelens-action`, switch
to `uses: codelens/codelens-action@v1`.)

```yaml
name: CodeLens Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  checks: write          # required to publish the status check
  pull-requests: read

jobs:
  codelens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/codelens-review
        with:
          repo_id: 00000000-0000-0000-0000-000000000000   # your CodeLens repo UUID
          codelens_api_token: ${{ secrets.CODELENS_API_TOKEN }}
          fail_on_severity: 'critical,high'                # optional (default)
          wait_timeout_seconds: '300'                      # optional (default)
          # codelens_api_url: 'https://app.codelens.dev'   # optional override
```

## 3. Make it required (optional)

Add **CodeLens Review** as a required status check under
**Settings → Branches → Branch protection** to block merges when it fails.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `repo_id` | yes | — | CodeLens repository UUID |
| `codelens_api_token` | yes | — | Per-repo CI token (`codelens_pat_…`) |
| `fail_on_severity` | no | `critical,high` | Comma-separated severities that fail the check |
| `wait_timeout_seconds` | no | `300` | Max seconds to wait for the review |
| `codelens_api_url` | no | `https://app.codelens.dev` | CodeLens API base URL |
| `github_token` | no | `${{ github.token }}` | Token used to create the check run (`checks:write`) |

## How it works

1. The action POSTs to `POST /api/repos/:repoId/pulls/:number/reviews/ci-check` with the
   CI token. The endpoint resolves the PR's head SHA, reuses an existing `ready` review
   for that SHA if present, otherwise **triggers a review and blocks** until it's ready
   (or the timeout elapses).
2. The endpoint returns `{ status: 'pass' | 'fail', severity_counts, summary_markdown, codelens_url }`.
   `fail` means at least one finding's severity is in `fail_on_severity`.
3. The action writes a GitHub check run (`conclusion: success | failure`) with the summary
   and fails the step on `fail`.

The token is never stored in plaintext server-side — only an HMAC-SHA256 hash is kept and
matched on each request.
