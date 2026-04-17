import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CodeReviewPanel from '../CodeReviewPanel';

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

describe('CodeReviewPanel', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => makeSseResponse([
      { type: 'sources', sources: [] },
      { type: 'chunk', text: 'Looks good.' },
      { type: 'done' },
    ]));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('disables actions when snippet is empty and validates line limit', async () => {
    const user = userEvent.setup();
    render(<CodeReviewPanel repoId="repo-1" />);

    expect(screen.getByRole('button', { name: /review code/i })).toBeDisabled();

    const textarea = screen.getByPlaceholderText(/paste your code here/i);
    await user.type(textarea, 'const x = 1;');
    expect(screen.getByRole('button', { name: /review code/i })).toBeEnabled();

    // Over limit (201 lines)
    const over = Array.from({ length: 201 }, () => 'x').join('\n');
    // userEvent.type is character-by-character and can be slow for large inputs; set value directly.
    fireEvent.change(textarea, { target: { value: over } });
    expect(screen.getByRole('button', { name: /review code/i })).toBeDisabled();
  });

  it('streams and displays a review response', async () => {
    const user = userEvent.setup();
    render(<CodeReviewPanel repoId="repo-1" />);

    const textarea = screen.getByPlaceholderText(/paste your code here/i);
    await user.type(textarea, 'const x = 1;');

    await user.click(screen.getByRole('button', { name: /review code/i }));
    expect(await screen.findByText(/looks good/i)).toBeInTheDocument();
  });
});
