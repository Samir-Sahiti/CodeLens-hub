import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TourEditor, { validateForm } from '../TourEditor';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, session: { access_token: 'token-1' } }),
}));

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock('../Toast', () => ({ useToast: () => toast }));

const baseTour = {
  id:             'tour-1',
  repo_id:        'repo-1',
  created_by:     'user-1',
  title:          'Auth flow',
  description:    'A look at authentication',
  is_team_shared: false,
  steps: [
    { id: 's1', step_order: 1, file_path: 'src/login.js',  start_line: 1, end_line: 20, explanation: 'Login handler entry point.' },
    { id: 's2', step_order: 2, file_path: 'src/verify.js', start_line: 5, end_line: 40, explanation: 'Verifies the credentials.' },
  ],
};

const graphNodes = [
  { file_path: 'src/login.js' },
  { file_path: 'src/verify.js' },
  { file_path: 'src/logout.js' },
];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  toast.success.mockReset();
  toast.error.mockReset();
});

function renderEditor(overrides = {}) {
  return render(
    <TourEditor
      repoId="repo-1"
      tour={baseTour}
      open
      graphNodes={graphNodes}
      repoHasTeam={false}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      {...overrides}
    />
  );
}

describe('validateForm', () => {
  it('requires a title', () => {
    const errors = validateForm({
      title: '',
      steps: [
        { file_path: 'a.js', start_line: 1, end_line: 2, explanation: 'ten chars___' },
        { file_path: 'b.js', start_line: 1, end_line: 2, explanation: 'ten chars___' },
      ],
      knownPaths: new Set(['a.js', 'b.js']),
    });
    expect(errors.title).toBeDefined();
  });

  it('rejects fewer than 2 steps', () => {
    const errors = validateForm({
      title: 'Title',
      steps: [{ file_path: 'a.js', start_line: 1, end_line: 2, explanation: 'ten chars___' }],
      knownPaths: new Set(['a.js']),
    });
    expect(errors._form).toMatch(/at least 2 steps/i);
  });

  it('rejects unknown file paths', () => {
    const errors = validateForm({
      title: 'Title',
      steps: [
        { file_path: 'a.js',     start_line: 1, end_line: 2, explanation: 'long enough description' },
        { file_path: 'mystery.js', start_line: 1, end_line: 2, explanation: 'long enough description' },
      ],
      knownPaths: new Set(['a.js']),
    });
    expect(errors['steps.1.file_path']).toMatch(/not in this repo/i);
  });

  it('rejects end_line less than start_line', () => {
    const errors = validateForm({
      title: 'Title',
      steps: [
        { file_path: 'a.js', start_line: 10, end_line: 5,  explanation: 'long enough description' },
        { file_path: 'a.js', start_line: 1,  end_line: 2,  explanation: 'long enough description' },
      ],
      knownPaths: new Set(['a.js']),
    });
    expect(errors['steps.0.end_line']).toMatch(/start/i);
  });

  it('rejects short explanations', () => {
    const errors = validateForm({
      title: 'Title',
      steps: [
        { file_path: 'a.js', start_line: 1, end_line: 2, explanation: 'short' },
        { file_path: 'a.js', start_line: 1, end_line: 2, explanation: 'long enough description' },
      ],
      knownPaths: new Set(['a.js']),
    });
    expect(errors['steps.0.explanation']).toBeDefined();
  });

  it('accepts a fully valid form', () => {
    const errors = validateForm({
      title: 'Auth flow',
      steps: [
        { file_path: 'a.js', start_line: 1, end_line: 2, explanation: 'long enough description' },
        { file_path: 'b.js', start_line: 1, end_line: 2, explanation: 'long enough description' },
      ],
      knownPaths: new Set(['a.js', 'b.js']),
    });
    expect(errors).toEqual({});
  });
});

describe('<TourEditor /> rendering & behaviour', () => {
  it('hydrates fields from the tour prop', () => {
    renderEditor();
    expect(screen.getByDisplayValue('Auth flow')).toBeInTheDocument();
    expect(screen.getByDisplayValue('A look at authentication')).toBeInTheDocument();
    expect(screen.getByDisplayValue('src/login.js')).toBeInTheDocument();
    expect(screen.getByDisplayValue('src/verify.js')).toBeInTheDocument();
  });

  it('does not render when open=false', () => {
    const { queryByTestId } = renderEditor({ open: false });
    expect(queryByTestId('tour-editor')).toBeNull();
  });

  it('disables step deletion when only 2 steps remain', () => {
    renderEditor();
    const deleteButtons = screen.getAllByLabelText(/at least 2 steps required|delete step/i);
    expect(deleteButtons).toHaveLength(2);
    deleteButtons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('enables deletion once a third step is added', async () => {
    renderEditor();
    const addBtn = screen.getByRole('button', { name: /add step/i });
    fireEvent.click(addBtn);
    const deleteButtons = await screen.findAllByLabelText(/delete step/i);
    expect(deleteButtons.length).toBeGreaterThanOrEqual(3);
    expect(deleteButtons[0]).not.toBeDisabled();
  });

  it('hides the share toggle when the repo has no team association', () => {
    renderEditor({ repoHasTeam: false, tour: { ...baseTour, is_team_shared: false } });
    expect(screen.queryByRole('switch', { name: /share with team/i })).toBeNull();
  });

  it('shows the share toggle when the repo has a team', () => {
    renderEditor({ repoHasTeam: true });
    expect(screen.getByRole('switch', { name: /share with team/i })).toBeInTheDocument();
  });

  it('PATCHes the server on save and calls onSaved with returned tour', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    global.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        tour: { ...baseTour, title: 'Renamed' },
        steps: baseTour.steps,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    renderEditor({ onSaved, onClose });
    const titleInput = screen.getByDisplayValue('Auth flow');
    fireEvent.change(titleInput, { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const call = global.fetch.mock.calls[0];
    expect(call[0]).toMatch(/\/api\/repos\/repo-1\/tours\/tour-1$/);
    expect(call[1].method).toBe('PATCH');
    const body = JSON.parse(call[1].body);
    expect(body.title).toBe('Renamed');
    expect(body.steps).toHaveLength(2);
    expect(body.steps[0].order).toBe(0);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call the server when validation fails', async () => {
    renderEditor();
    const titleInput = screen.getByDisplayValue('Auth flow');
    fireEvent.change(titleInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await Promise.resolve();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
