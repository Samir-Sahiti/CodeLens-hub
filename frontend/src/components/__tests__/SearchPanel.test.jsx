import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SearchPanel from '../SearchPanel';

vi.mock('../../context/AuthContext', () => {
  return {
    useAuth: () => ({ session: { access_token: 'test-token' } }),
  };
});

function makeSseResponse(events) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('SearchPanel', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => makeSseResponse([
      { type: 'sources', sources: [{ file_path: 'a.js', start_line: 1, end_line: 2, content: 'x' }] },
      { type: 'chunk', text: 'Hello' },
      { type: 'chunk', text: ' world' },
      { type: 'done' },
    ]));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders empty state before querying', () => {
    render(<SearchPanel repoId="repo-1" />);
    expect(screen.getByText(/ask anything about your codebase/i)).toBeInTheDocument();
  });

  it('streams and displays an answer', async () => {
    const user = userEvent.setup();
    render(<SearchPanel repoId="repo-1" />);

    const example = await screen.findByRole('button', { name: /how does authentication work/i });
    await user.click(example);

    expect(await screen.findByText(/hello world/i)).toBeInTheDocument();
  });
});

