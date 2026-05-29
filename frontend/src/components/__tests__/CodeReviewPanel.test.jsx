import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CodeReviewPanel from '../CodeReviewPanel';

const routerMock = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [routerMock.searchParams, vi.fn()],
}));

vi.mock('../../context/AuthContext', () => {
  return {
    useAuth: () => ({ session: { access_token: 'test-token' } }),
  };
});

vi.mock('../Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

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
    routerMock.searchParams = new URLSearchParams();
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

  it('exposes manual GitHub publish for linked PR reviews', async () => {
    const user = userEvent.setup();
    routerMock.searchParams = new URLSearchParams('review=review-1');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      event: 'COMMENT',
      inline_comments: 1,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    render(<CodeReviewPanel repoId="repo-1" />);

    await user.click(screen.getByRole('button', { name: /publish to github/i }));

    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/repos/repo-1/reviews/review-1/publish'), expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    }));
    expect(await screen.findByText(/published as comment/i)).toBeInTheDocument();
  });

  it('sends security_audit mode and renders structured findings', async () => {
    const user = userEvent.setup();
    let body = null;
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      if (String(url).includes('/security-audits') && options.method !== 'POST') {
        return new Response(JSON.stringify({ audits: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      body = JSON.parse(options.body);
      return makeSseResponse([
        { type: 'sources', sources: [] },
        {
          type: 'finding',
          finding: {
            severity: 'high',
            category: 'injection',
            line_reference: 'src/a.js:2',
            explanation: 'Unsanitized input reaches exec.',
            suggested_fix: 'Use an allowlist.',
            confidence: 'high',
            matching_analysis_issues: [{ id: 'i1', type: 'insecure_pattern', description: 'exec call' }],
          },
        },
        { type: 'done' },
      ]);
    });

    render(<CodeReviewPanel repoId="repo-1" />);

    await user.click(screen.getByRole('button', { name: /security audit/i }));
    await user.type(screen.getByPlaceholderText(/paste code to audit/i), 'exec(req.body.cmd)');
    await user.click(screen.getByRole('button', { name: /audit code/i }));

    expect(body.mode).toBe('security_audit');
    expect(await screen.findByText(/unsanitized input reaches exec/i)).toBeInTheDocument();
    expect(screen.getByText(/confidence: high/i)).toBeInTheDocument();
    expect(screen.getByText(/deterministic agreement/i)).toBeInTheDocument();
  });

  it('runs whole-repo security audit and tolerates malformed SSE events', async () => {
    const user = userEvent.setup();
    const encoder = new TextEncoder();
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      if (String(url).includes('/security-audits') && options.method !== 'POST') {
        return new Response(JSON.stringify({ audits: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"progress","file_path":"src/a.js","index":1,"total":1,"status":"auditing"}\n\n'));
          controller.enqueue(encoder.encode('data: {malformed\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"summary","status":"complete","summary":{"audited_count":1,"skipped_count":0,"findings_count":0,"narrative":"Security audit completed."}}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    });

    render(<CodeReviewPanel repoId="repo-1" />);

    await user.click(screen.getByRole('button', { name: /security audit/i }));
    await user.click(screen.getByRole('button', { name: /run security audit/i }));

    expect(await screen.findByText(/security audit completed/i)).toBeInTheDocument();
    expect(screen.getByText(/1 audited/i)).toBeInTheDocument();
  });

  it('prefills a file audit in Security Audit mode', async () => {
    render(<CodeReviewPanel repoId="repo-1" prefill={{ mode: 'security_audit', filePath: 'src/a.js', content: 'const token = req.body.token;' }} />);

    expect(await screen.findByDisplayValue(/const token/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /audit code/i })).toBeInTheDocument();
    expect(screen.getByText('src/a.js')).toBeInTheDocument();
  });
});
