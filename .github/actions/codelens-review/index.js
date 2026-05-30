/**
 * CodeLens PR Review action (US-076).
 *
 * Dependency-free Node 20 action: reads inputs from INPUT_* env vars, calls the
 * CodeLens CI-check endpoint, and reports the result as a GitHub check run.
 * No bundling step required — uses global fetch + the built-in event payload.
 */
const fs = require('fs');

function getInput(name, def = '') {
  const value = process.env[`INPUT_${name.toUpperCase().replace(/ /g, '_')}`];
  return value === undefined || value === '' ? def : value.trim();
}

function info(message) {
  process.stdout.write(`${message}\n`);
}

function setFailed(message) {
  process.stdout.write(`::error::${message}\n`);
  process.exitCode = 1;
}

async function httpJson(method, url, headers, body) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: res.status, ok: res.ok, json, text };
}

(async () => {
  try {
    const repoId = getInput('repo_id');
    const apiToken = getInput('codelens_api_token');
    const failOn = getInput('fail_on_severity', 'critical,high');
    const waitTimeout = getInput('wait_timeout_seconds', '300');
    const apiUrl = getInput('codelens_api_url', 'https://app.codelens.dev').replace(/\/+$/, '');
    const ghToken = getInput('github_token') || process.env.GITHUB_TOKEN;

    if (!repoId || !apiToken) {
      return setFailed('Inputs repo_id and codelens_api_token are required.');
    }

    const eventPath = process.env.GITHUB_EVENT_PATH;
    const event = eventPath && fs.existsSync(eventPath) ? JSON.parse(fs.readFileSync(eventPath, 'utf8')) : {};
    const pr = event.pull_request;
    if (!pr || !pr.number) {
      return setFailed('This action must run on pull_request events.');
    }
    const prNumber = pr.number;
    const headSha = pr.head?.sha || process.env.GITHUB_SHA;
    const [owner, repo] = (process.env.GITHUB_REPOSITORY || '/').split('/');

    info(`Requesting CodeLens review for PR #${prNumber} (head ${String(headSha).slice(0, 7)})...`);
    const resp = await httpJson(
      'POST',
      `${apiUrl}/api/repos/${repoId}/pulls/${prNumber}/reviews/ci-check`,
      { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      { fail_on_severity: failOn, wait_timeout_seconds: Number(waitTimeout) },
    );

    if (!resp.ok) {
      return setFailed(`CodeLens CI check failed (HTTP ${resp.status}): ${resp.json?.error || resp.text || 'unknown error'}`);
    }

    const result = resp.json || {};
    const counts = result.severity_counts || {};
    const conclusion = result.status === 'pass' ? 'success' : 'failure';
    const title = result.status === 'pass'
      ? 'CodeLens: no blocking findings'
      : `CodeLens: ${failOn} findings present`;
    const summary = result.summary_markdown || 'CodeLens PR review complete.';

    if (ghToken && owner && repo && headSha) {
      const checkRes = await httpJson(
        'POST',
        `${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${owner}/${repo}/check-runs`,
        {
          Authorization: `Bearer ${ghToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'codelens-review-action',
        },
        { name: 'CodeLens Review', head_sha: headSha, status: 'completed', conclusion, output: { title, summary } },
      );
      if (!checkRes.ok) {
        info(`Warning: could not create check run (HTTP ${checkRes.status}): ${checkRes.json?.message || ''}`);
      }
    } else {
      info('Skipping check-run creation (missing github token or repo context).');
    }

    info(`CodeLens result: ${result.status} — critical ${counts.critical || 0}, high ${counts.high || 0}, medium ${counts.medium || 0}, low ${counts.low || 0}`);
    if (result.codelens_url) info(`Full review: ${result.codelens_url}`);

    if (result.status !== 'pass') {
      return setFailed(`CodeLens found ${failOn} severity findings. See ${result.codelens_url || 'CodeLens'}.`);
    }
    info('CodeLens check passed.');
  } catch (err) {
    setFailed(`CodeLens action error: ${err.message || err}`);
  }
})();
