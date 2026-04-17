import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DependencyGraph from '../DependencyGraph';

vi.mock('../../hooks/useGraphSimulation', () => {
  return {
    useGraphSimulation: () => ({
      resetView: () => {},
    }),
  };
});

describe('DependencyGraph', () => {
  it('shows "Chat with this file" in the details panel and calls handler', async () => {
    const user = userEvent.setup();
    const onChatWithFile = vi.fn();

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
      />
    );

    const btn = await screen.findByRole('button', { name: /chat with this file/i });
    await user.click(btn);

    expect(onChatWithFile).toHaveBeenCalledWith('src/a.js');
  });
});

