import { describe, expect, it } from 'vitest';

import { buildStartHereWalk } from '../src/services/startHereTourService.js';

describe('buildStartHereWalk', () => {
  it('returns empty when there are no nodes', () => {
    expect(buildStartHereWalk([], [])).toEqual([]);
  });

  it('prefers a source-classified node as the start node', () => {
    const nodes = [
      { file_path: 'a.js', incoming_count: 50, complexity_score: 1, node_classification: null },
      { file_path: 'b.js', incoming_count: 10, complexity_score: 2, node_classification: 'source' },
    ];
    const walk = buildStartHereWalk(nodes, []);
    expect(walk[0]).toBe('b.js');
  });

  it('falls back to highest incoming_count when no source exists', () => {
    const nodes = [
      { file_path: 'a.js', incoming_count: 5,  complexity_score: 0, node_classification: null },
      { file_path: 'b.js', incoming_count: 12, complexity_score: 0, node_classification: null },
      { file_path: 'c.js', incoming_count: 1,  complexity_score: 0, node_classification: null },
    ];
    expect(buildStartHereWalk(nodes, [])[0]).toBe('b.js');
  });

  it('walks forward preferring high (incoming + complexity) neighbours, capped at maxSteps', () => {
    const nodes = [
      { file_path: 'index.js',     incoming_count: 0, complexity_score: 0, node_classification: 'source' },
      { file_path: 'router.js',    incoming_count: 8, complexity_score: 7, node_classification: null },
      { file_path: 'config.js',    incoming_count: 1, complexity_score: 0, node_classification: null },
      { file_path: 'auth.js',      incoming_count: 6, complexity_score: 9, node_classification: null },
      { file_path: 'utils.js',     incoming_count: 2, complexity_score: 1, node_classification: null },
      { file_path: 'middleware.js', incoming_count: 4, complexity_score: 3, node_classification: null },
    ];
    const edges = [
      { from_path: 'index.js',  to_path: 'router.js' },
      { from_path: 'index.js',  to_path: 'config.js' },
      { from_path: 'router.js', to_path: 'auth.js' },
      { from_path: 'router.js', to_path: 'utils.js' },
      { from_path: 'auth.js',   to_path: 'middleware.js' },
    ];
    const walk = buildStartHereWalk(nodes, edges, 6);
    expect(walk[0]).toBe('index.js');
    expect(walk[1]).toBe('router.js');     // 8+7 > 1+0
    expect(walk[2]).toBe('auth.js');       // 6+9 > 2+1
    expect(walk[3]).toBe('middleware.js'); // only reachable neighbour
    expect(walk).not.toContain('config.js');
  });

  it('honours the maxSteps cap', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      file_path: `f${i}.js`,
      incoming_count: 20 - i,
      complexity_score: 0,
      node_classification: i === 0 ? 'source' : null,
    }));
    const edges = nodes.slice(0, -1).map((n, i) => ({
      from_path: n.file_path,
      to_path:   nodes[i + 1].file_path,
    }));
    expect(buildStartHereWalk(nodes, edges, 6)).toHaveLength(6);
  });

  it('stops walking when a node has no unvisited outgoing edges', () => {
    const nodes = [
      { file_path: 'a.js', incoming_count: 10, complexity_score: 0, node_classification: 'source' },
      { file_path: 'b.js', incoming_count: 1,  complexity_score: 0, node_classification: null },
    ];
    const edges = [{ from_path: 'a.js', to_path: 'b.js' }];
    expect(buildStartHereWalk(nodes, edges, 6)).toEqual(['a.js', 'b.js']);
  });

  it('treats source and both classifications as equivalent for start-node pick', () => {
    const nodes = [
      { file_path: 'a.js', incoming_count: 30, complexity_score: 0, node_classification: null },
      { file_path: 'b.js', incoming_count: 1,  complexity_score: 0, node_classification: 'both' },
      { file_path: 'c.js', incoming_count: 5,  complexity_score: 0, node_classification: 'source' },
    ];
    // pool = [b, c]; sort by incoming desc → c wins (5 > 1)
    expect(buildStartHereWalk(nodes, [])[0]).toBe('c.js');
  });
});
