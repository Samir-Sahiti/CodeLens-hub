import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ session: { access_token: 'token-1' } }),
}));

import IssuesPanel from '../IssuesPanel';

function makeSseResponse(events) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

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
    if (String(url).includes('/duplication')) {
      return {
        ok: true,
        json: async () => ({ clusters: [] }),
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

  it('opens proposal panel from every IssueCard without selecting nodes and renders cached proposal', async () => {
    const user = userEvent.setup();
    const onNodeSelect = vi.fn();

    global.fetch = vi.fn(async (url) => {
      const textUrl = String(url);
      if (textUrl.includes('/proposals')) {
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            proposal: {
              id: 'proposal-1',
              status: 'pending',
              summary: 'Extract shared parsing helper.',
              rationale: 'The issue repeats parsing behavior in one hotspot.',
              changes: [{ file_path: 'a.js', diff: '--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-oldCall()\n+newCall()' }],
              risks: ['Call sites may need manual review.'],
            },
          }),
        };
      }
      if (textUrl.includes('/status')) {
        return { ok: true, json: async () => ({ status: 'ready', latest_job: { core_ready: true } }) };
      }
      if (textUrl.includes('/duplication')) {
        return { ok: true, json: async () => ({ clusters: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(
      <IssuesPanel
        repoId="repo-1"
        nodes={[{ id: 'n1', file_path: 'a.js' }]}
        issues={[{ id: 'i1', type: 'dead_code', severity: 'low', file_paths: ['a.js'], description: 'Unused' }]}
        onNodeSelect={onNodeSelect}
        onOpenDependencies={vi.fn()}
        onOpenFile={vi.fn()}
      />
    );

    expect(screen.getAllByRole('button', { name: /propose fix/i })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /propose fix/i }));

    expect(onNodeSelect).not.toHaveBeenCalled();
    expect(await screen.findByRole('dialog', { name: /refactor proposal/i })).toBeInTheDocument();
    expect(await screen.findByText(/extract shared parsing helper/i)).toBeInTheDocument();
    expect(screen.getByText(/the issue repeats parsing behavior/i)).toBeInTheDocument();
    expect(screen.getAllByText('a.js').length).toBeGreaterThan(0);
    expect(screen.getByText(/call sites may need manual review/i)).toBeInTheDocument();
  });

  it('renders stale proposal with banner and does not auto-regenerate', async () => {
    const user = userEvent.setup();
    const proposalCalls = [];

    global.fetch = vi.fn(async (url) => {
      const textUrl = String(url);
      if (textUrl.includes('/proposals')) {
        proposalCalls.push(textUrl);
        return {
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            proposal: {
              id: 'proposal-stale',
              status: 'stale',
              summary: 'Old summary.',
              rationale: 'Old rationale.',
              changes: [{ file_path: 'a.js', diff: '--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+new' }],
              risks: ['Old risk.'],
            },
          }),
        };
      }
      if (textUrl.includes('/status')) {
        return { ok: true, json: async () => ({ status: 'ready', latest_job: { core_ready: true } }) };
      }
      if (textUrl.includes('/duplication')) {
        return { ok: true, json: async () => ({ clusters: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(
      <IssuesPanel
        repoId="repo-1"
        nodes={[{ id: 'n1', file_path: 'a.js' }]}
        issues={[{ id: 'i1', type: 'dead_code', severity: 'low', file_paths: ['a.js'], description: 'Unused' }]}
        onNodeSelect={vi.fn()}
        onOpenDependencies={vi.fn()}
        onOpenFile={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /propose fix/i }));

    expect(await screen.findByText('This file has changed since this proposal was generated')).toBeInTheDocument();
    expect(screen.getByText('Old summary.')).toBeInTheDocument();
    expect(proposalCalls.filter((url) => url.includes('regenerate=true'))).toHaveLength(0);
  });

  it('streams summary, rationale, diffs, risks, regenerates, copies, discards, and closes with Escape', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const fetchCalls = [];

    global.fetch = vi.fn(async (url, options = {}) => {
      const textUrl = String(url);
      fetchCalls.push({ url: textUrl, options });
      if (textUrl.includes('/proposals/proposal-1')) {
        expect(options.method).toBe('PATCH');
        expect(JSON.parse(options.body)).toEqual({ status: 'discarded' });
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (textUrl.includes('/proposals')) {
        return makeSseResponse([
          { type: 'summary_delta', text: 'First summary. ' },
          { type: 'rationale_delta', text: 'First rationale.' },
          { type: 'change', change: { file_path: 'a.js', diff: '--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-old\n+new\n context' } },
          { type: 'risk', risk: 'Regression risk.' },
          { type: 'done', proposal_id: 'proposal-1', status: 'pending' },
        ]);
      }
      if (textUrl.includes('/status')) {
        return { ok: true, json: async () => ({ status: 'ready', latest_job: { core_ready: true } }) };
      }
      if (textUrl.includes('/duplication')) {
        return { ok: true, json: async () => ({ clusters: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(
      <IssuesPanel
        repoId="repo-1"
        nodes={[{ id: 'n1', file_path: 'a.js' }]}
        issues={[{ id: 'i1', type: 'dead_code', severity: 'low', file_paths: ['a.js'], description: 'Unused' }]}
        onNodeSelect={vi.fn()}
        onOpenDependencies={vi.fn()}
        onOpenFile={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /propose fix/i }));

    expect(await screen.findByText(/first summary/i)).toBeInTheDocument();
    expect(screen.getByText(/first rationale/i)).toBeInTheDocument();
    expect(screen.getAllByText('a.js').length).toBeGreaterThan(0);
    expect(screen.getByText(/regression risk/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /copy diff/i }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('-old'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('+new'));

    await user.click(screen.getByRole('button', { name: /regenerate/i }));
    await waitFor(() => {
      expect(fetchCalls.some((call) => call.url.includes('regenerate=true'))).toBe(true);
    });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /refactor proposal/i })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /propose fix/i }));
    expect(await screen.findByText(/first summary/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /discard/i }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /refactor proposal/i })).not.toBeInTheDocument();
    });
  });

  it('cancel aborts an active proposal stream and leaves partial content visible', async () => {
    const user = userEvent.setup();
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

    global.fetch = vi.fn(async (url) => {
      const textUrl = String(url);
      if (textUrl.includes('/proposals')) {
        const encoder = new TextEncoder();
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'summary_delta', text: 'Partial summary.' })}\n\n`));
          },
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      if (textUrl.includes('/status')) {
        return { ok: true, json: async () => ({ status: 'ready', latest_job: { core_ready: true } }) };
      }
      if (textUrl.includes('/duplication')) {
        return { ok: true, json: async () => ({ clusters: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    render(
      <IssuesPanel
        repoId="repo-1"
        nodes={[{ id: 'n1', file_path: 'a.js' }]}
        issues={[{ id: 'i1', type: 'dead_code', severity: 'low', file_paths: ['a.js'], description: 'Unused' }]}
        onNodeSelect={vi.fn()}
        onOpenDependencies={vi.fn()}
        onOpenFile={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /propose fix/i }));
    expect(await screen.findByText(/partial summary/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(abortSpy).toHaveBeenCalled();
    expect(screen.getByText(/partial summary/i)).toBeInTheDocument();
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

  it('renders duplication clusters, opens two-pane detail, switches members, and streams AI refactor', async () => {
    const user = userEvent.setup();
    let refactorCalled = false;

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
          json: async () => [],
        };
      }
      if (String(url).includes('/duplication-refactor')) {
        refactorCalled = true;
        return makeSseResponse([
          { type: 'chunk', text: 'Extract a shared helper.' },
          { type: 'done' },
        ]);
      }
      if (String(url).includes('/duplication')) {
        return {
          ok: true,
          json: async () => ({
            clusters: [{
              id: 'dup-1',
              severity: 'medium',
              member_count: 3,
              total_lines: 45,
              similarity_min: 0.94,
              similarity_max: 0.97,
              members: [
                { chunk_id: 'a', file_path: 'src/a.js', start_line: 1, end_line: 15, content: 'function sameA() {\n  return 1;\n}', excerpt: 'function sameA()' },
                { chunk_id: 'b', file_path: 'src/b.js', start_line: 2, end_line: 16, content: 'function sameB() {\n  return 1;\n}', excerpt: 'function sameB()' },
                { chunk_id: 'c', file_path: 'src/c.js', start_line: 3, end_line: 17, content: 'function sameC() {\n  return 1;\n}', excerpt: 'function sameC()' },
              ],
            }],
          }),
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
        nodes={[]}
        issues={[]}
        onNodeSelect={vi.fn()}
        onOpenDependencies={vi.fn()}
        onOpenFile={vi.fn()}
      />
    );

    const clusterButton = await screen.findByText(/3 chunks/i);
    expect(clusterButton).toBeInTheDocument();
    await user.click(clusterButton);

    expect(await screen.findByRole('dialog', { name: /duplicate code cluster/i })).toBeInTheDocument();
    expect(screen.getAllByText(/src\/a\.js:1-15/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/src\/b\.js:2-16/i).length).toBeGreaterThan(0);

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[1], '2');
    expect(screen.getAllByText(/src\/c\.js:3-17/i).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /ask ai to extract shared utility/i }));
    expect(await screen.findByText(/extract a shared helper/i)).toBeInTheDocument();
    expect(refactorCalled).toBe(true);
  });
});

