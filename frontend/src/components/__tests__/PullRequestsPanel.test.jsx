import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PullRequestsPanel, { PRListItem, SeverityBreakdown } from '../PullRequestsPanel';
import { ToastProvider } from '../Toast';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ session: { access_token: 'token-1' } }),
}));

function renderPanel(initialEntry = '/repo/repo-1?tab=pulls') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <PullRequestsPanel repoId="repo-1" repo={{ name: 'demo' }} active />
      </ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  let suppressed = false;
  global.fetch = vi.fn(async (url, options = {}) => {
    const textUrl = String(url);
    if (textUrl.includes('/api/repos/repo-1/pulls?')) {
      return {
        ok: true,
        json: async () => ({
          pr_review_enabled: true,
          authors: ['alice'],
          pulls: [
            {
              number: 42,
              title: 'Fix auth',
              html_url: 'https://github.test/owner/repo/pull/42',
              author: { login: 'alice', avatar_url: 'https://github.test/a.png' },
              head_sha: 'abcdef123456',
              base_sha: '123456abcdef',
              updated_at: '2026-05-01T10:00:00Z',
              review_status: 'ready',
              latest_review: {
                id: 'review-1',
                status: 'ready',
                total_findings: 1,
                severity_counts: { critical: 0, high: 1, medium: 0, low: 0 },
                updated_at: '2026-05-01T11:00:00Z',
              },
            },
          ],
        }),
      };
    }
    if (textUrl.includes('/api/reviews/review-1')) {
      return {
        ok: true,
        json: async () => ({
          review: {
            id: 'review-1',
            pr_number: 42,
            status: 'ready',
            pr_head_sha: 'abcdef123456',
            pr_base_sha: '123456abcdef',
            total_findings: 1,
            severity_counts: suppressed ? { critical: 0, high: 0, medium: 0, low: 0 } : { critical: 0, high: 1, medium: 0, low: 0 },
            github_review_url: 'https://github.test/owner/repo/pull/42#discussion_r9',
            findings_json: suppressed ? [] : [
              {
                id: 'finding-1',
                type: 'insecure_pattern',
                severity: 'high',
                file_path: 'src/auth.js',
                line_number: 12,
                rule_id: 'missing_check',
                message: 'Missing auth check.',
                github_url: 'https://github.test/owner/repo/pull/42#discussion_r10',
              },
            ],
          },
          pull_request: {
            number: 42,
            title: 'Fix auth',
            html_url: 'https://github.test/owner/repo/pull/42',
            author: { login: 'alice', avatar_url: null },
          },
          stale_index: { is_stale: false, indexed_sha: null, pr_head_sha: 'abcdef123456' },
        }),
      };
    }
    if (textUrl.includes('/api/repos/repo-1/pulls/42/reviews')) {
      return {
        ok: true,
        json: async () => ({ reviews: [{ id: 'review-1', status: 'ready', pr_number: 42, pr_head_sha: 'abcdef123456', updated_at: '2026-05-01T11:00:00Z' }] }),
      };
    }
    if (textUrl.includes('/api/analysis/repo-1/issues/suppress')) {
      suppressed = true;
      return { ok: true, json: async () => ({ success: true, body: options.body }) };
    }
    if (textUrl.includes('/api/repos/repo-1')) {
      return { ok: true, json: async () => ({ ok: true, repo: { pr_review_enabled: true } }) };
    }
    return { ok: true, json: async () => ({}) };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PullRequestsPanel', () => {
  it('renders PRListItem and SeverityBreakdown primitives', () => {
    const onSelect = vi.fn();
    render(
      <>
        <PRListItem
          pull={{
            number: 7,
            title: 'Tighten auth',
            author: { login: 'dev' },
            head_sha: 'abcdef123',
            review_status: 'ready',
            latest_review: { severity_counts: { critical: 1, high: 0, medium: 0, low: 0 }, updated_at: '2026-05-01T10:00:00Z' },
          }}
          onSelect={onSelect}
        />
        <SeverityBreakdown counts={{ critical: 1, high: 2, medium: 0, low: 3 }} />
      </>
    );
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText('Tighten auth')).toBeInTheDocument();
    expect(screen.getByText(/critical: 1/i)).toBeInTheDocument();
  });

  it('shows disabled empty state from the list endpoint and enables PR review', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn(async (url, options = {}) => {
      if (String(url).includes('/pulls?')) {
        return { ok: true, json: async () => ({ pr_review_enabled: false, pulls: [], authors: [] }) };
      }
      return { ok: true, json: async () => ({ ok: true, options }) };
    });

    renderPanel();

    expect(await screen.findByText("PR review isn't enabled for this repo.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /enable/i }));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/repos/repo-1'), expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ pr_review_enabled: true }),
    }));
  });

  it('renders detail, suppresses a finding, updates counts, and refreshes detail', async () => {
    const user = userEvent.setup();
    renderPanel('/repo/repo-1?tab=pulls&pr=42&review=review-1');

    expect(await screen.findByText('Missing auth check.')).toBeInTheDocument();
    expect(screen.getByText(/high: 1/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^suppress$/i }));

    await waitFor(() => expect(screen.queryByText('Missing auth check.')).not.toBeInTheDocument());
    expect(screen.getByText(/high: 0/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/analysis/repo-1/issues/suppress'), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ file_path: 'src/auth.js', rule_id: 'missing_check', line_number: 12 }),
    }));
  });
});
