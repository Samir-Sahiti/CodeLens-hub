import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import MetricsPanel from '../MetricsPanel';

describe('MetricsPanel', () => {
  const nodes = [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `n-${i}`,
      file_path: `src/n-${i}.js`,
      language: 'javascript',
      line_count: 10 + i,
      outgoing_count: 1,
      incoming_count: 1 + i,
      complexity_score: 1 + i,
    })),
    { id: 'core', file_path: 'src/core.js', language: 'javascript', line_count: 999, outgoing_count: 1, incoming_count: 999, complexity_score: 999 },
  ];

  it('filters by file path and highlights critical rows', async () => {
    const user = userEvent.setup();

    render(
      <MetricsPanel
        nodes={nodes}
        selectedNode={null}
        onNodeSelect={vi.fn()}
        onAnalyseImpact={vi.fn()}
      />
    );

    await user.type(screen.getByPlaceholderText(/search by file path/i), 'core.js');
    expect(screen.getByText('src/core.js')).toBeInTheDocument();
    expect(screen.queryByText('src/n-0.js')).not.toBeInTheDocument();

    const row = screen.getByText('src/core.js').closest('tr');
    expect(row?.className).toMatch(/bg-red-900\/30/);
  });

  it('keeps row selection local but uses Analyse impact for graph handoff', async () => {
    const user = userEvent.setup();
    const onNodeSelect = vi.fn();
    const onAnalyseImpact = vi.fn();

    render(
      <MetricsPanel
        nodes={nodes}
        selectedNode={nodes[nodes.length - 1]}
        onNodeSelect={onNodeSelect}
        onAnalyseImpact={onAnalyseImpact}
      />
    );

    await user.click(screen.getAllByText('src/core.js')[0]);
    expect(onNodeSelect).toHaveBeenCalledWith('core');
    expect(onNodeSelect.mock.calls[0]).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /analyse impact/i }));
    expect(onAnalyseImpact).toHaveBeenCalledWith(nodes[nodes.length - 1]);
  });
});
