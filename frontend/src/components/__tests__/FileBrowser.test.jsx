import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import FileBrowser from '../FileBrowser';

vi.mock('../../context/AuthContext', () => {
  return {
    useAuth: () => ({ session: { access_token: 'test-token' } }),
  };
});

vi.mock('../Toast', () => {
  return {
    useToast: () => ({ success: vi.fn(), error: vi.fn() }),
  };
});

describe('FileBrowser', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ content: 'const token = req.body.token;', language: 'javascript' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows Audit this file in the code-view header and calls handler', async () => {
    const user = userEvent.setup();
    const onAuditFile = vi.fn();

    render(
      <MemoryRouter>
        <FileBrowser
          repoId="repo-1"
          nodes={[{ id: 'n1', file_path: 'src/a.js', language: 'javascript' }]}
          onAuditFile={onAuditFile}
        />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: /a\.js/i }));
    await user.click(await screen.findByRole('button', { name: /audit this file/i }));
    expect(onAuditFile).toHaveBeenCalledWith('src/a.js');
  });
});
