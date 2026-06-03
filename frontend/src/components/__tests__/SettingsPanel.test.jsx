import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsPanel from '../SettingsPanel';
import { prReviewPublishMessage } from '../../lib/api';

const toast = { success: vi.fn(), error: vi.fn() };

vi.mock('../Toast', () => ({
  useToast: () => toast,
}));

describe('SettingsPanel', () => {
  const originalFetch = globalThis.fetch;
  const repo = {
    id: 'repo-1',
    source: 'github',
    auto_sync_enabled: false,
    pr_review_auto_publish: false,
    pr_review_block_on_severity: 'critical',
  };

  beforeEach(() => {
    toast.success.mockClear();
    toast.error.mockClear();
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders PR review publish controls and disabled banner', async () => {
    render(<SettingsPanel repo={repo} session={{ access_token: 'token-1' }} onRepoUpdated={vi.fn()} />);

    expect(screen.getByText(/auto-publish pr reviews/i)).toBeInTheDocument();
    expect(screen.getByText(/PR findings will stay in CodeLens until you publish them manually/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/request changes on/i)).toHaveValue('critical');
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  });

  it('patches auto-publish and block severity settings', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel repo={repo} session={{ access_token: 'token-1' }} onRepoUpdated={vi.fn()} />);

    await user.click(screen.getByRole('switch', { name: /toggle auto-publish pr reviews/i }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/repos/repo-1'), expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ pr_review_auto_publish: true }),
    })));

    await user.selectOptions(screen.getByLabelText(/request changes on/i), 'high');
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/repos/repo-1'), expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ pr_review_block_on_severity: 'high' }),
    })));
  });

  it('maps PR review publish failures to user-facing messages', () => {
    expect(prReviewPublishMessage(401)).toMatch(/reconnect github/i);
    expect(prReviewPublishMessage(403)).toMatch(/write access/i);
    expect(prReviewPublishMessage(422)).toMatch(/retried once/i);
  });
});
