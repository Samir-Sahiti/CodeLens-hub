import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import Layout from '../Layout';
import ToursPanel, { EMPTY_TEXT } from '../ToursPanel';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'dev@example.com', user_metadata: { user_name: 'dev' } },
    session: { access_token: 'token-1' },
    signOut: vi.fn(),
  }),
}));

vi.mock('../../context/RepoContext', () => ({
  useRepo: () => ({ repo: { name: 'Repo', status: 'ready' }, issueCount: 0 }),
}));

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };

vi.mock('../Toast', () => ({
  useToast: () => toast,
}));

const baseTours = [
  {
    id: 'start',
    repo_id: 'repo-1',
    created_by: 'user-1',
    title: 'Start Here',
    description: 'An auto-generated walkthrough.',
    original_query: null,
    is_auto_generated: true,
    is_team_shared: false,
    updated_at: '2026-05-01T00:00:00Z',
    step_count: 2,
    creator: { id: 'user-1', name: 'Dev User', avatar_url: 'https://example.com/avatar.png' },
    steps: [{ id: 's1', step_order: 1, file_path: 'a.js', start_line: 1, end_line: 2, explanation: 'A' }],
    can_delete: true,
  },
  {
    id: 'auto-other',
    repo_id: 'repo-1',
    created_by: 'user-1',
    title: 'Generated Auth',
    description: null,
    original_query: 'How does auth work?',
    is_auto_generated: true,
    is_team_shared: false,
    updated_at: '2026-05-02T00:00:00Z',
    step_count: 1,
    creator: { id: 'user-1', name: 'Dev User', avatar_url: 'https://example.com/avatar.png' },
    steps: [{ id: 's2', step_order: 1, file_path: 'b.js', start_line: 1, end_line: 2, explanation: 'B' }],
    can_delete: true,
  },
  {
    id: 'team',
    repo_id: 'repo-1',
    created_by: 'user-2',
    title: 'Team Tour',
    description: 'Shared context.',
    original_query: null,
    is_auto_generated: false,
    is_team_shared: true,
    updated_at: '2026-05-03T00:00:00Z',
    step_count: 1,
    creator: { id: 'user-2', name: 'Teammate', avatar_url: 'https://example.com/team.png' },
    steps: [{ id: 's3', step_order: 1, file_path: 'c.js', start_line: 1, end_line: 2, explanation: 'C' }],
    can_delete: false,
  },
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockToursFetch(tours = baseTours) {
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    const urlText = String(url);
    if (urlText.endsWith('/tours') && (!options.method || options.method === 'GET')) {
      return jsonResponse({ tours });
    }
    if (urlText.endsWith('/tours/generate')) {
      return jsonResponse({
        tour: {
          id: 'generated',
          title: 'Generated tour',
          created_by: 'user-1',
          is_auto_generated: false,
          is_team_shared: false,
          updated_at: '2026-05-04T00:00:00Z',
        },
        steps: [{ id: 'gs1', step_order: 1, file_path: 'generated.js', start_line: 1, end_line: 2, explanation: 'Generated' }],
      });
    }
    if (options.method === 'DELETE') {
      return jsonResponse({ ok: true });
    }
    return jsonResponse({});
  });
}

describe('ToursPanel', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockToursFetch();
    toast.error.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('adds Tours to the repo sidebar between Search and Code Review', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ used: 0, limit: 1000 }));
    render(
      <MemoryRouter
        initialEntries={['/repo/repo-1?tab=tours']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/repo/:repoId" element={<Layout />}>
            <Route index element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('Tokens today');
    const nav = screen.getByRole('navigation');
    const labels = within(nav).getAllByRole('link').map((link) => link.textContent);
    expect(labels.indexOf('Search')).toBeLessThan(labels.indexOf('Tours'));
    expect(labels.indexOf('Tours')).toBeLessThan(labels.indexOf('Code Review'));
  });

  it('groups tours exactly and keeps non-Start-Here auto tours out of Featured', async () => {
    render(<ToursPanel repoId="repo-1" onStartTour={vi.fn()} />);

    const featured = await screen.findByText('Featured');
    const myTours = screen.getByText('My tours');
    const teamTours = screen.getByText('Team tours');

    expect(featured).toBeInTheDocument();
    expect(myTours).toBeInTheDocument();
    expect(teamTours).toBeInTheDocument();
    expect(screen.getByText('Start Here')).toBeInTheDocument();
    expect(screen.getByText('Generated Auth')).toBeInTheDocument();
    expect(screen.getByText('Team Tour')).toBeInTheDocument();

    const featuredSection = featured.closest('section');
    expect(within(featuredSection).getByText('Start Here')).toBeInTheDocument();
    expect(within(featuredSection).queryByText('Generated Auth')).not.toBeInTheDocument();
  });

  it('renders card details and starts a selected tour with steps', async () => {
    const onStartTour = vi.fn();
    const user = userEvent.setup();
    render(<ToursPanel repoId="repo-1" onStartTour={onStartTour} />);

    expect(await screen.findByText('An auto-generated walkthrough.')).toBeInTheDocument();
    expect(screen.getByText('How does auth work?')).toBeInTheDocument();
    expect(screen.getAllByText(/steps?/i).length).toBeGreaterThan(0);
    expect(screen.getAllByAltText('Dev User avatar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Dev User').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Updated/i).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: /start tour/i })[0]);
    expect(onStartTour).toHaveBeenCalledWith(expect.objectContaining({
      id: 'start',
      steps: expect.any(Array),
    }));
  });

  it('generates a saved tour and starts it immediately', async () => {
    const onStartTour = vi.fn();
    const user = userEvent.setup();
    render(<ToursPanel repoId="repo-1" onStartTour={onStartTour} />);

    await user.type(await screen.findByLabelText(/ask a question to generate a new tour/i), 'How does billing work?');
    await user.click(screen.getByRole('button', { name: /generate tour/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/repos/repo-1/tours/generate'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ query: 'How does billing work?', save: true }),
        })
      );
    });
    expect(onStartTour).toHaveBeenCalledWith(expect.objectContaining({ id: 'generated' }));
  });

  it('shows the exact empty state and focuses the composer', async () => {
    mockToursFetch([]);
    render(<ToursPanel repoId="repo-1" onStartTour={vi.fn()} />);

    expect(await screen.findByText(EMPTY_TEXT)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText(/ask a question to generate a new tour/i)).toHaveFocus();
    });
  });

  it('requires confirmation before deleting a creator-owned tour', async () => {
    const user = userEvent.setup();
    render(<ToursPanel repoId="repo-1" onStartTour={vi.fn()} />);

    await screen.findByText('Generated Auth');
    await user.click(screen.getAllByRole('button', { name: /tour actions/i })[0]);
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    expect(screen.getByRole('dialog', { name: /delete tour/i })).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/repos/repo-1/tours/start'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  it('paginates only groups with more than 30 tours', async () => {
    const manyTours = Array.from({ length: 31 }, (_, index) => ({
      ...baseTours[1],
      id: `mine-${index}`,
      title: `Mine ${index + 1}`,
      is_auto_generated: false,
    }));
    mockToursFetch([baseTours[0], ...manyTours]);

    render(<ToursPanel repoId="repo-1" onStartTour={vi.fn()} />);

    expect(await screen.findByText('Mine 1')).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();

    const featuredSection = screen.getByText('Featured').closest('section');
    expect(within(featuredSection).queryByText(/Page/i)).not.toBeInTheDocument();
  });
});
