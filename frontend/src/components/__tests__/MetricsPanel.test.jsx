import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    await waitFor(() => {
      expect(screen.getByText('src/core.js')).toBeInTheDocument();
      expect(screen.queryByText('src/n-0.js')).not.toBeInTheDocument();
    });

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

  it('counts coverage using formal data precedence and excludes test files', async () => {
    const user = userEvent.setup();
    const coverageNodes = [
      { id: 'covered-import', file_path: 'src/covered-import.js', language: 'javascript', is_test_file: false, has_test_coverage: true, coverage_percentage: null, line_count: 1, incoming_count: 1, outgoing_count: 0, complexity_score: 1 },
      { id: 'covered-formal', file_path: 'src/covered-formal.js', language: 'javascript', is_test_file: false, has_test_coverage: false, coverage_percentage: 25, line_count: 1, incoming_count: 1, outgoing_count: 0, complexity_score: 1 },
      { id: 'formal-zero', file_path: 'src/formal-zero.js', language: 'javascript', is_test_file: false, has_test_coverage: true, coverage_percentage: 0, line_count: 1, incoming_count: 10, outgoing_count: 0, complexity_score: 10 },
      { id: 'test-file', file_path: 'src/example.test.js', language: 'javascript', is_test_file: true, has_test_coverage: false, coverage_percentage: null, line_count: 1, incoming_count: 0, outgoing_count: 1, complexity_score: 1 },
    ];

    render(
      <MetricsPanel
        nodes={coverageNodes}
        selectedNode={null}
        onNodeSelect={vi.fn()}
        onAnalyseImpact={vi.fn()}
        hasCoverageFiles
      />
    );

    expect(screen.getByText(/2 of 3 source files are covered via execution data or imports \(67% by file\)/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show 1 coverage gap/i }));
    expect(screen.getAllByText('src/formal-zero.js').length).toBeGreaterThan(0);
  });
});
