import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TourViewer, { MISSING_FILE_MESSAGE } from '../TourViewer';

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
};

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ session: { access_token: 'test-token' } }),
}));

vi.mock('../Toast', () => ({
  useToast: () => toast,
}));

const tour = {
  id: 'tour-1',
  title: 'Authentication flow',
  steps: [
    {
      id: 'step-1',
      step_order: 1,
      file_path: 'src/auth.js',
      start_line: 2,
      end_line: 3,
      explanation: 'This checks the token before the request continues.',
    },
    {
      id: 'step-2',
      step_order: 2,
      file_path: 'src/session.js',
      start_line: 1,
      end_line: 1,
      explanation: 'This loads the active session.',
    },
  ],
};

function mockFileFetch(content = 'line-one\nline-two\nline-three\nline-four', language = 'javascript') {
  globalThis.fetch = vi.fn(async () => new Response(
    JSON.stringify({ content, language }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  ));
}

function renderViewer(props = {}) {
  return render(
    <TourViewer
      repoId="repo-1"
      tour={tour}
      open
      stepIndex={0}
      onStepChange={vi.fn()}
      onClose={vi.fn()}
      onFinish={vi.fn()}
      {...props}
    />
  );
}

describe('TourViewer', () => {
  const originalFetch = globalThis.fetch;
  let clipboardSpy;

  beforeEach(() => {
    mockFileFetch();
    clipboardSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    toast.success.mockClear();
    toast.error.mockClear();
    toast.warning.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clipboardSpy?.mockRestore();
  });

  it('renders the header, progress, step metadata, explanation, and sliced highlighted code', async () => {
    const { container } = renderViewer();

    expect(screen.getByText('Authentication flow')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('src/auth.js')).toBeInTheDocument();
    expect(screen.getByText('L2-L3')).toBeInTheDocument();
    expect(screen.getByText(/checks the token/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /tour progress/i })).toHaveAttribute('aria-valuenow', '50');

    await waitFor(() => expect(container.textContent).toContain('line-two'));
    expect(container.textContent).toContain('line-three');
    expect(container.textContent).not.toContain('line-one');
  });

  it('copies the file path and shows a toast', async () => {
    renderViewer();

    fireEvent.click(screen.getByTitle('Copy file path'));

    await waitFor(() => expect(clipboardSpy).toHaveBeenCalledWith('src/auth.js'));
    expect(toast.success).toHaveBeenCalledWith('Copied src/auth.js');
  });

  it('copies a deep link to the current step and shows a toast (US-062)', async () => {
    renderViewer({ stepIndex: 1 });

    fireEvent.click(screen.getByLabelText(/copy link to this step/i));

    await waitFor(() => expect(clipboardSpy).toHaveBeenCalledTimes(1));
    const url = clipboardSpy.mock.calls[0][0];
    expect(url).toMatch(/\/repo\/repo-1\?tour=tour-1&step=2$/);
    expect(toast.success).toHaveBeenCalledWith('Link copied — step 2 of Authentication flow');
  });

  it('renders "Forked from" attribution when forked_from is set (US-061)', () => {
    renderViewer({
      tour: {
        ...tour,
        forked_from: 'original-tour-id',
        forked_from_creator: { id: 'user-2', name: 'Alice' },
      },
    });
    expect(screen.getByText('Forked from Alice')).toBeInTheDocument();
  });

  it('disables Prev on the first step, advances with Next, and finishes on the last step', async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    const onFinish = vi.fn();
    const { rerender } = renderViewer({ onStepChange, onFinish });

    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(onStepChange).toHaveBeenCalledWith(1);

    rerender(
      <TourViewer
        repoId="repo-1"
        tour={tour}
        open
        stepIndex={1}
        onStepChange={onStepChange}
        onClose={vi.fn()}
        onFinish={onFinish}
      />
    );

    await user.click(screen.getByRole('button', { name: /finish/i }));
    expect(onFinish).toHaveBeenCalled();
  });

  it('supports ArrowLeft, ArrowRight, and Escape keyboard shortcuts', async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    const onClose = vi.fn();
    const onFinish = vi.fn();
    renderViewer({ stepIndex: 1, onStepChange, onClose, onFinish });

    await user.keyboard('{ArrowLeft}');
    expect(onStepChange).toHaveBeenCalledWith(0);

    await user.keyboard('{ArrowRight}');
    expect(onFinish).toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores navigation shortcuts while focus is inside an input', async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    render(
      <>
        <input aria-label="Scratch input" />
        <TourViewer
          repoId="repo-1"
          tour={tour}
          open
          stepIndex={1}
          onStepChange={onStepChange}
          onClose={vi.fn()}
          onFinish={vi.fn()}
        />
      </>
    );

    await user.click(screen.getByLabelText(/scratch input/i));
    await user.keyboard('{ArrowLeft}');
    expect(onStepChange).not.toHaveBeenCalled();
  });

  it('shows missing-file messaging and skips gracefully on 404', async () => {
    const user = userEvent.setup();
    const onStepChange = vi.fn();
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ error: 'No indexed content for this file' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    ));

    renderViewer({ onStepChange });

    expect(await screen.findByText(MISSING_FILE_MESSAGE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it('uses non-modal responsive right-panel and bottom-sheet classes', async () => {
    const { container } = renderViewer();
    const viewer = screen.getByTestId('tour-viewer');

    expect(viewer.className).toContain('bottom-0');
    expect(viewer.className).toContain('max-h-[80vh]');
    expect(viewer.className).toContain('lg:right-0');
    expect(viewer.className).toContain('lg:top-0');
    expect(viewer.className).toContain('lg:max-w-2xl');
    expect(viewer.className).not.toContain('backdrop');
    await waitFor(() => expect(container.textContent).toContain('line-two'));
  });
});
