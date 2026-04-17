/**
 * Issue detection — architectural smells (US-035)
 *
 * Pure logic module to keep indexer IO orchestration testable.
 */

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function detectCircularDependencyIssues({ repoId, edges }) {
  const issues = [];

  const adjacencyList = new Map();
  for (const edge of edges) {
    if (!edge?.from_path || !edge?.to_path) continue;
    if (!adjacencyList.has(edge.from_path)) adjacencyList.set(edge.from_path, []);
    adjacencyList.get(edge.from_path).push(edge.to_path);
  }

  const visited = new Set();
  const recStack = new Set();
  const cycles = [];

  const detectCycle = (node, pathArr) => {
    visited.add(node);
    recStack.add(node);
    pathArr.push(node);

    const neighbors = adjacencyList.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        detectCycle(neighbor, pathArr);
      } else if (recStack.has(neighbor)) {
        const startIdx = pathArr.indexOf(neighbor);
        const cyclePaths = pathArr.slice(startIdx);
        cycles.push(cyclePaths);
      }
    }

    pathArr.pop();
    recStack.delete(node);
  };

  const allNodes = new Set();
  edges.forEach((e) => {
    if (e?.from_path) allNodes.add(e.from_path);
    if (e?.to_path) allNodes.add(e.to_path);
  });

  for (const node of allNodes) {
    if (!visited.has(node)) detectCycle(node, []);
  }

  if (cycles.length > 0) {
    for (const cycle of cycles.slice(0, 10)) {
      issues.push({
        repo_id: repoId,
        type: 'circular_dependency',
        severity: 'high',
        file_paths: cycle,
        description: 'A circular dependency cycle was detected.',
      });
    }
  }

  return issues;
}

function detectPerFileIssues({ repoId, nodes }) {
  const issues = [];
  const totalNodes = nodes.length || 1;

  for (const node of nodes) {
    // God file
    const godCondition1 = node.incoming_count >= 10 && node.incoming_count > (totalNodes * 0.3);
    const godCondition2 = node.line_count > 500 && node.incoming_count > (totalNodes * 0.1);
    if (godCondition1 || godCondition2) {
      issues.push({
        repo_id: repoId,
        type: 'god_file',
        severity: (godCondition1 && godCondition2) ? 'high' : 'medium',
        file_paths: [node.file_path],
        description: 'This file is imported heavily — changes here have an extremely wide blast radius.',
      });
    }

    // High coupling
    if (node.outgoing_count > 15) {
      let severity = 'low';
      if (node.outgoing_count >= 30) severity = 'high';
      else if (node.outgoing_count >= 20) severity = 'medium';

      issues.push({
        repo_id: repoId,
        type: 'high_coupling',
        severity,
        file_paths: [node.file_path],
        description: `This file imports ${node.outgoing_count} other files — it may be doing too much and is difficult to test or refactor.`,
      });
    }

    // Dead code
    if (node.incoming_count === 0 && node.language !== 'c_sharp') {
      const lowerPath = (node.file_path || '').toLowerCase();
      const isEntryPoint =
        lowerPath.endsWith('index.js') ||
        lowerPath.endsWith('main.py') ||
        lowerPath.endsWith('program.cs') ||
        lowerPath.endsWith('app.js') ||
        lowerPath.endsWith('server.js') ||
        lowerPath.endsWith('index.ts') ||
        lowerPath.endsWith('app.tsx');

      if (!isEntryPoint && !node.file_path.includes('.test.') && !node.file_path.includes('.spec.')) {
        issues.push({
          repo_id: repoId,
          type: 'dead_code',
          severity: 'low',
          file_paths: [node.file_path],
          description: 'No other files import this file — it may be unused.',
        });
      }
    }
  }

  return issues;
}

function detectIssues({ repoId, nodes, edges }) {
  const circular = detectCircularDependencyIssues({ repoId, edges });
  const perFile = detectPerFileIssues({ repoId, nodes });
  return [...circular, ...perFile];
}

module.exports = { detectIssues, chunkArray };

