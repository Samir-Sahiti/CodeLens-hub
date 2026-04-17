import { describe, expect, it } from 'vitest';

import { detectIssues } from '../src/services/issueDetection.js';

describe('issueDetection.detectIssues', () => {
  it('detects circular dependency cycles', () => {
    const edges = [
      { from_path: 'a.js', to_path: 'b.js' },
      { from_path: 'b.js', to_path: 'c.js' },
      { from_path: 'c.js', to_path: 'a.js' },
    ];

    const nodes = [
      { file_path: 'a.js', language: 'javascript', incoming_count: 1, outgoing_count: 1, line_count: 10 },
      { file_path: 'b.js', language: 'javascript', incoming_count: 1, outgoing_count: 1, line_count: 10 },
      { file_path: 'c.js', language: 'javascript', incoming_count: 1, outgoing_count: 1, line_count: 10 },
    ];

    const issues = detectIssues({ repoId: 'repo-1', nodes, edges });
    expect(issues.some((i) => i.type === 'circular_dependency')).toBe(true);
  });

  it('detects god files, high coupling, and dead code', () => {
    const nodes = [
      // God file: high incoming relative to total + high line_count
      { file_path: 'core.js', language: 'javascript', incoming_count: 20, outgoing_count: 2, line_count: 800 },
      // High coupling
      { file_path: 'coupled.js', language: 'javascript', incoming_count: 1, outgoing_count: 25, line_count: 50 },
      // Dead code (non entrypoint)
      { file_path: 'unused.js', language: 'javascript', incoming_count: 0, outgoing_count: 0, line_count: 10 },
      // Entry point: should not be dead code
      { file_path: 'index.js', language: 'javascript', incoming_count: 0, outgoing_count: 1, line_count: 10 },
    ];

    const edges = [];

    const issues = detectIssues({ repoId: 'repo-1', nodes, edges });

    expect(issues.some((i) => i.type === 'god_file' && i.file_paths[0] === 'core.js')).toBe(true);
    expect(issues.some((i) => i.type === 'high_coupling' && i.file_paths[0] === 'coupled.js')).toBe(true);
    expect(issues.some((i) => i.type === 'dead_code' && i.file_paths[0] === 'unused.js')).toBe(true);
    expect(issues.some((i) => i.type === 'dead_code' && i.file_paths[0] === 'index.js')).toBe(false);
  });
});

