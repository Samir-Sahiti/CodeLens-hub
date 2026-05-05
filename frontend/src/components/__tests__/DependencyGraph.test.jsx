import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DependencyGraph from '../DependencyGraph';

const { resetViewMock } = vi.hoisted(() => ({ resetViewMock: vi.fn() }));

vi.mock('../../hooks/useGraphSimulation', () => {
  return {
    useGraphSimulation: () => ({
      resetView: resetViewMock,
    }),
  };
});

describe('DependencyGraph', () => {
  it('renders an intentional empty state when graph data is unavailable', () => {
    render(
      <DependencyGraph
        nodes={[]}
        edges={[]}
        issues={[]}
        selectedNodeId={null}
        impactAnalysis={null}
        onNodeSelect={() => {}}
        onAnalyseImpact={() => {}}
        onClearImpactAnalysis={() => {}}
        repoName="repo"
      />
    );

    expect(screen.getByText(/no graph data yet/i)).toBeInTheDocument();
  });

  it('shows "Chat with this file" in the details panel and calls handler', async () => {
    const user = userEvent.setup();
    const onChatWithFile = vi.fn();
    const onAuditFile = vi.fn();

    render(
      <DependencyGraph
        nodes={[
          { id: 'n1', file_path: 'src/a.js', language: 'javascript', line_count: 10, outgoing_count: 0, incoming_count: 0, complexity_score: 0 },
        ]}
        edges={[]}
        issues={[]}
        selectedNodeId="n1"
        impactAnalysis={null}
        onNodeSelect={() => {}}
        onAnalyseImpact={() => {}}
        onClearImpactAnalysis={() => {}}
        repoName="repo"
        onChatWithFile={onChatWithFile}
        onAuditFile={onAuditFile}
      />
    );

    const btn = await screen.findByRole('button', { name: /chat with this file/i });
    await user.click(btn);

    expect(onChatWithFile).toHaveBeenCalledWith('src/a.js');

    await user.click(screen.getByRole('button', { name: /audit this file/i }));
    expect(onAuditFile).toHaveBeenCalledWith('src/a.js');
  });

  it('shows impact analysis details and clear action', async () => {
    const user = userEvent.setup();
    const onClearImpactAnalysis = vi.fn();

    render(
      <DependencyGraph
        nodes={[
          { id: 'n1', file_path: 'src/a.js', language: 'javascript', line_count: 10, outgoing_count: 0, incoming_count: 2, complexity_score: 0 },
          { id: 'n2', file_path: 'src/b.js', language: 'javascript', line_count: 12, outgoing_count: 1, incoming_count: 0, complexity_score: 0 },
        ]}
        edges={[{ from_path: 'src/b.js', to_path: 'src/a.js' }]}
        issues={[]}
        selectedNodeId="n1"
        impactAnalysis={{
          sourceId: 'n1',
          sourcePath: 'src/a.js',
          sourceName: 'a.js',
          direct: ['src/b.js'],
          transitive: [],
          directIds: ['n2'],
          transitiveIds: [],
        }}
        onNodeSelect={() => {}}
        onAnalyseImpact={() => {}}
        onClearImpactAnalysis={onClearImpactAnalysis}
        repoName="repo"
      />
    );

    expect(screen.getByText(/impact analysis/i)).toBeInTheDocument();
    expect(screen.getByText('src/b.js')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(onClearImpactAnalysis).toHaveBeenCalled();
  });

  it('toggles coverage mode and reset clears graph state', async () => {
    const user = userEvent.setup();
    const onNodeSelect = vi.fn();
    const onClearImpactAnalysis = vi.fn();
    resetViewMock.mockClear();

    render(
      <DependencyGraph
        nodes={[
          { id: 'n1', file_path: 'src/a.js', language: 'javascript', line_count: 10, outgoing_count: 0, incoming_count: 0, complexity_score: 0 },
        ]}
        edges={[]}
        issues={[]}
        selectedNodeId="n1"
        impactAnalysis={null}
        onNodeSelect={onNodeSelect}
        onAnalyseImpact={() => {}}
        onClearImpactAnalysis={onClearImpactAnalysis}
        repoName="repo"
      />
    );

    await user.click(screen.getByRole('button', { name: /coverage/i }));
    expect(screen.getByText(/low coverage/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /reset view/i }));
    expect(onNodeSelect).toHaveBeenCalledWith(null);
    expect(onClearImpactAnalysis).toHaveBeenCalled();
    expect(resetViewMock).toHaveBeenCalled();
  });
});

