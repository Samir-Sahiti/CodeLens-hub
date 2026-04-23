import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ session: { access_token: 'token-1' } }),
}));

import IssuesPanel from '../IssuesPanel';

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
});

