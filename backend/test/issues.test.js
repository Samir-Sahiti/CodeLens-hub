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

  it('flags untested critical source files while respecting 0% formal coverage overrides', () => {
    const nodes = [
      { file_path: 'src/covered.js', is_test_file: false, has_test_coverage: true, coverage_percentage: null, incoming_count: 1, outgoing_count: 0, complexity_score: 2, language: 'javascript', line_count: 10 },
      { file_path: 'src/plain-uncovered.js', is_test_file: false, has_test_coverage: false, coverage_percentage: null, incoming_count: 2, outgoing_count: 0, complexity_score: 3, language: 'javascript', line_count: 10 },
      { file_path: 'src/plain-low.js', is_test_file: false, has_test_coverage: false, coverage_percentage: null, incoming_count: 3, outgoing_count: 0, complexity_score: 4, language: 'javascript', line_count: 10 },
      { file_path: 'src/plain-critical.js', is_test_file: false, has_test_coverage: false, coverage_percentage: null, incoming_count: 50, outgoing_count: 0, complexity_score: 60, language: 'javascript', line_count: 100 },
      { file_path: 'src/formal-zero.js', is_test_file: false, has_test_coverage: true, coverage_percentage: 0, incoming_count: 65, outgoing_count: 0, complexity_score: 80, language: 'javascript', line_count: 100 },
      { file_path: 'src/covered.test.js', is_test_file: true, has_test_coverage: false, coverage_percentage: null, incoming_count: 0, outgoing_count: 1, complexity_score: 80, language: 'javascript', line_count: 50 },
    ];

    const issues = detectIssues({ repoId: 'repo-1', nodes, edges: [] });

    expect(issues.some((i) => i.type === 'untested_critical_file' && i.file_paths[0] === 'src/formal-zero.js')).toBe(true);
    expect(issues.some((i) => i.type === 'untested_critical_file' && i.file_paths[0] === 'src/plain-uncovered.js')).toBe(false);
    expect(issues.some((i) => i.type === 'untested_critical_file' && i.file_paths[0] === 'src/covered.test.js')).toBe(false);
  });
});

