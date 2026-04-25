import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ session: { access_token: 'token-1' } }),
}));

import IssuesPanel from '../IssuesPanel';

beforeEach(() => {
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes('/status')) {
      return {
        ok: true,
        json: async () => ({ status: 'ready', latest_job: { core_ready: true } }),
      };
    }
    if (String(url).includes('/issues')) {
      return {
        ok: true,
        json: async () => ({ data: [] }),
      };
    }
    return {
      ok: true,
      json: async () => ({}),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('IssuesPanel', () => {
  it('groups issues and shows severity badges; clicking selects nodes', async () => {
    const user = userEvent.setup();
    const onNodeSelect = vi.fn();

    render(
      <IssuesPanel
        nodes={[
          { id: 'n1', file_path: 'a.js' },
          { id: 'n2', file_path: 'b.js' },
        ]}
        issues={[
          { id: 'i1', type: 'dead_code', severity: 'low', file_paths: ['a.js'], description: 'Unused' },
          { id: 'i2', type: 'circular_dependency', severity: 'high', file_paths: ['a.js', 'b.js'], description: 'Cycle' },
        ]}
        onNodeSelect={onNodeSelect}
      />
    );

    expect(screen.getByText(/circular dependencies/i)).toBeInTheDocument();
    expect(screen.getByText(/dead code/i)).toBeInTheDocument();
    expect(screen.getByText(/high/i)).toBeInTheDocument();
    expect(screen.getByText(/low/i)).toBeInTheDocument();

    await user.click(screen.getByText('Cycle'));
    expect(onNodeSelect).toHaveBeenCalledWith(['n1', 'n2']);
  });

  it('disables issue actions while core indexing is not ready', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/status')) {
        return {
          ok: true,
          json: async () => ({ status: 'indexing', latest_job: { core_ready: false } }),
        };
      }
      if (String(url).includes('/issues')) {
        return {
          ok: true,
          json: async () => ({ data: [] }),
        };
      }
      return {
        ok: true,
        json: async () => ({}),
      };
    });

    render(
      <IssuesPanel
        repoId="repo-1"
        nodes={[{ id: 'n1', file_path: 'a.js' }]}
        issues={[
          {
            id: 'i1',
            type: 'hardcoded_secret',
            severity: 'high',
            file_paths: ['a.js'],
            description: 'Rule ID: TEST_SECRET) line 10',
          },
        ]}
        onNodeSelect={vi.fn()}
        onOpenDependencies={vi.fn()}
        onOpenFile={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/temporarily disabled while the repository is re-indexing/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /mark as false positive/i })).toBeDisabled();
  });
});

