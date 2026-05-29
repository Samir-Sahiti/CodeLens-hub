/**
 * Graph service — pure query + traversal helpers over graph_nodes / graph_edges.
 *
 * Used both by the analysis HTTP routes (graph / metrics / impact) and by the
 * AI Repo Agent tool surface (US-068). No req/res — async functions that
 * return data or throw.
 *
 * Design notes:
 * - `getBlastRadius` returns disjoint sets: `direct = depth 1`, `transitive
 *   = depth ≥ 2`. This is the contract both the frontend Impact panel and
 *   the agent tool agree on; the panel renders the two counts side-by-side
 *   and a single Source of Truth lives here.
 * - `countCycles` is iterative (explicit work stack) so deep SCCs don't
 *   blow Node's call stack.
 * - BFS uses a head-pointer queue, not `Array.prototype.shift()`.
 * - `buildAdjacency` optionally filters out phantom edge targets (third-
 *   party imports like `'react'` that the parser emits but never resolve
 *   to a real `graph_nodes` row).
 * - Loaders are memoised per-request via AsyncLocalStorage so multiple
 *   agent tools in a single Anthropic iteration share one fetch.
 */

const { supabaseAdmin } = require('../db/supabase');
const { SAFE_FETCH_CEILING, warnIfCeilingHit } = require('../lib/dbHelpers');
const { getStore } = require('../observability/requestStore');

const HUB_LIMIT = 10;

// ─── per-request memo ─────────────────────────────────────────────────────

/**
 * Memoise an async loader inside the current AsyncLocalStorage request. Two
 * agent tools that both need the edge list in the same chat iteration will
 * share one Supabase round-trip. Falls through to the loader when no store
 * is active (e.g. called from the indexer or a test).
 */
async function requestMemo(key, loader) {
  const store = getStore();
  if (!store) return loader();
  if (!store.graphCache) store.graphCache = new Map();
  if (store.graphCache.has(key)) return store.graphCache.get(key);
  const promise = loader();
  // Cache the *promise* so concurrent callers de-duplicate even before the
  // first resolution lands. If the loader throws we don't poison the cache.
  store.graphCache.set(key, promise);
  try {
    const result = await promise;
    return result;
  } catch (err) {
    store.graphCache.delete(key);
    throw err;
  }
}

// ─── loaders ──────────────────────────────────────────────────────────────

async function loadEdges(repoId) {
  return requestMemo(`edges:${repoId}`, async () => {
    const { data, error } = await supabaseAdmin
      .from('graph_edges')
      .select('from_path, to_path, symbols')
      .eq('repo_id', repoId)
      .range(0, SAFE_FETCH_CEILING - 1);
    if (error) throw new Error(`graph_edges fetch failed: ${error.message}`);
    warnIfCeilingHit('graphService.loadEdges', data);
    return data || [];
  });
}

async function loadNodes(repoId, columns = 'file_path, language, line_count, complexity_score, incoming_count, outgoing_count, node_classification, is_test_file') {
  // The columns argument is in the cache key so callers that need extra
  // columns don't accidentally consume a shorter cached payload.
  return requestMemo(`nodes:${repoId}:${columns}`, async () => {
    const { data, error } = await supabaseAdmin
      .from('graph_nodes')
      .select(columns)
      .eq('repo_id', repoId)
      .range(0, SAFE_FETCH_CEILING - 1);
    if (error) throw new Error(`graph_nodes fetch failed: ${error.message}`);
    warnIfCeilingHit('graphService.loadNodes', data);
    return data || [];
  });
}

/** Cheap path-only fetch for phantom-edge filtering. Always cached. */
async function loadNodePaths(repoId) {
  const rows = await loadNodes(repoId, 'file_path');
  return new Set(rows.map((r) => r.file_path));
}

// ─── adjacency ────────────────────────────────────────────────────────────

/**
 * Build forward + reverse adjacency Maps from edges.
 *
 * If `validNodes` is provided, edges whose `to_path` isn't in the set are
 * dropped — this filters out phantom targets (third-party imports the parser
 * emits but that have no `graph_nodes` row).
 */
function buildAdjacency(edges, validNodes = null) {
  const forward = new Map();
  const reverse = new Map();
  for (const e of edges) {
    if (!e?.from_path || !e?.to_path) continue;
    if (validNodes && !validNodes.has(e.to_path)) continue;
    if (!forward.has(e.from_path)) forward.set(e.from_path, []);
    forward.get(e.from_path).push(e.to_path);
    if (!reverse.has(e.to_path)) reverse.set(e.to_path, []);
    reverse.get(e.to_path).push(e.from_path);
  }
  return { forward, reverse };
}

// ─── cycle counting (iterative Tarjan) ────────────────────────────────────

/**
 * Count strongly-connected components of size > 1 (or self-loops).
 * Iterative Tarjan's algorithm — recursive variant blows the Node call stack
 * on repos with deep SCCs (~10K nodes).
 */
function countCycles(edges) {
  const adj = new Map();
  const allNodes = new Set();
  for (const e of edges) {
    if (!e?.from_path || !e?.to_path) continue;
    allNodes.add(e.from_path);
    allNodes.add(e.to_path);
    if (!adj.has(e.from_path)) adj.set(e.from_path, []);
    adj.get(e.from_path).push(e.to_path);
  }

  const indices = new Map();
  const lowlinks = new Map();
  const onStack = new Set();
  const sccStack = [];
  let nextIndex = 0;
  let sccCount = 0;

  for (const start of allNodes) {
    if (indices.has(start)) continue;

    // Explicit work stack of frames; each frame is `{ node, iter }` where
    // `iter` is the index into `adj.get(node)` we've consumed so far.
    const work = [{ node: start, iter: 0 }];
    indices.set(start, nextIndex);
    lowlinks.set(start, nextIndex);
    nextIndex += 1;
    sccStack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const neighbors = adj.get(frame.node) || [];

      if (frame.iter < neighbors.length) {
        const w = neighbors[frame.iter];
        frame.iter += 1;
        if (!indices.has(w)) {
          indices.set(w, nextIndex);
          lowlinks.set(w, nextIndex);
          nextIndex += 1;
          sccStack.push(w);
          onStack.add(w);
          work.push({ node: w, iter: 0 });
        } else if (onStack.has(w)) {
          lowlinks.set(frame.node, Math.min(lowlinks.get(frame.node), indices.get(w)));
        }
      } else {
        // Done with this node — fold lowlink up into parent (if any).
        if (lowlinks.get(frame.node) === indices.get(frame.node)) {
          // Root of an SCC: pop the SCC stack down to (and including) this node.
          let size = 0;
          let popped;
          do {
            popped = sccStack.pop();
            onStack.delete(popped);
            size += 1;
          } while (popped !== frame.node);
          if (size > 1 || (adj.get(frame.node) || []).includes(frame.node)) sccCount += 1;
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) {
          lowlinks.set(parent.node, Math.min(lowlinks.get(parent.node), lowlinks.get(frame.node)));
        }
      }
    }
  }

  return sccCount;
}

// ─── public API ───────────────────────────────────────────────────────────

/**
 * High-level graph stats for `/api/analysis/:repoId/graph` and the
 * `get_graph_overview` agent tool.
 *
 * Returns `cyclicComponentCount` (the count of strongly-connected components
 * that contain a cycle), not a count of distinct cycles — a 10-file SCC is
 * one component, not 10 cycles.
 */
async function getGraphOverview(repoId) {
  const [nodes, edges] = await Promise.all([loadNodes(repoId), loadEdges(repoId)]);
  // Tiebreak on file_path. loadNodes has no ORDER BY (the request-scoped
  // cache shares the same payload across calls so consistency is fine within
  // a request, but Postgres can return the rows in any order across requests
  // — without a deterministic tiebreaker the agent's "top hubs" output would
  // flicker when many files have the same incoming_count.
  const byPath = (a, b) => String(a.file_path).localeCompare(String(b.file_path));
  const topHubs = [...nodes]
    .sort((a, b) => (b.incoming_count || 0) - (a.incoming_count || 0) || byPath(a, b))
    .slice(0, HUB_LIMIT)
    .map((n) => ({ path: n.file_path, incoming_count: n.incoming_count || 0 }));
  const topSinks = [...nodes]
    .sort((a, b) => (b.outgoing_count || 0) - (a.outgoing_count || 0) || byPath(a, b))
    .slice(0, HUB_LIMIT)
    .map((n) => ({ path: n.file_path, outgoing_count: n.outgoing_count || 0 }));
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    topHubs,
    topSinks,
    cyclicComponentCount: countCycles(edges),
  };
}

/** Single-file metrics row. Returns null if unknown. */
async function getFileMetrics(repoId, path) {
  const { data, error } = await supabaseAdmin
    .from('graph_nodes')
    .select('file_path, language, line_count, complexity_score, incoming_count, outgoing_count, node_classification, is_test_file')
    .eq('repo_id', repoId)
    .eq('file_path', path)
    .maybeSingle();
  if (error) throw new Error(`graph_nodes fetch failed: ${error.message}`);
  return data || null;
}

/**
 * Blast radius — BFS over the REVERSE import edges from `path`. A change
 * to `path` propagates to files that import it (depth 1, returned as
 * `direct`) and to anything that transitively imports those (depth ≥ 2,
 * returned as `transitive`). The two sets are DISJOINT — the panel UI and
 * the agent both surface them as two distinct counts.
 *
 * `depth` bounds the BFS frontier. `Infinity` (default) walks the full
 * transitive closure. Both arrays are sorted alphabetically for stable
 * output between calls.
 */
async function getBlastRadius(repoId, path, depth = Infinity) {
  const [edges, validNodes] = await Promise.all([loadEdges(repoId), loadNodePaths(repoId)]);
  const { reverse } = buildAdjacency(edges, validNodes);

  const directSet = new Set();
  const transitiveSet = new Set();
  const visited = new Set([path]);

  // Head-pointer queue: O(1) dequeue. Array.shift would be O(N) per dequeue
  // → O(N²) BFS on large graphs.
  const queue = [];
  let head = 0;

  for (const importer of (reverse.get(path) || [])) {
    if (visited.has(importer)) continue;
    visited.add(importer);
    directSet.add(importer);
    queue.push({ node: importer, d: 1 });
  }

  while (head < queue.length) {
    const { node, d } = queue[head];
    head += 1;
    if (d >= depth) continue;
    for (const importer of (reverse.get(node) || [])) {
      if (visited.has(importer)) continue;
      visited.add(importer);
      transitiveSet.add(importer);
      queue.push({ node: importer, d: d + 1 });
    }
  }

  return {
    direct: [...directSet].sort(),
    transitive: [...transitiveSet].sort(),
  };
}

/** Files that import `path` (one-hop reverse). Filters phantom targets. */
async function getDependents(repoId, path) {
  const { data, error } = await supabaseAdmin
    .from('graph_edges')
    .select('from_path')
    .eq('repo_id', repoId)
    .eq('to_path', path)
    .range(0, SAFE_FETCH_CEILING - 1);
  if (error) throw new Error(`graph_edges fetch failed: ${error.message}`);
  warnIfCeilingHit('graphService.getDependents', data);
  return [...new Set((data || []).map((r) => r.from_path))];
}

/**
 * Files that `path` imports (one-hop forward). Filters out phantom targets
 * — only `to_path`s that are real `graph_nodes` rows are returned, so the
 * agent doesn't recommend reading `'react'` or `'fs'`.
 */
async function getImports(repoId, path) {
  const [edgeRowsResult, validNodes] = await Promise.all([
    supabaseAdmin
      .from('graph_edges')
      .select('to_path')
      .eq('repo_id', repoId)
      .eq('from_path', path)
      .range(0, SAFE_FETCH_CEILING - 1),
    loadNodePaths(repoId),
  ]);
  if (edgeRowsResult.error) throw new Error(`graph_edges fetch failed: ${edgeRowsResult.error.message}`);
  warnIfCeilingHit('graphService.getImports', edgeRowsResult.data);
  const targets = new Set();
  for (const row of (edgeRowsResult.data || [])) {
    if (validNodes.has(row.to_path)) targets.add(row.to_path);
  }
  return [...targets];
}

/**
 * All graph paths from `fromPath` to `toPath`, capped at `maxPaths` /
 * `maxDepth`. Result paths include both endpoints. Phantom edge targets
 * are filtered out so the agent never reports a path through a non-real
 * node.
 */
async function findPaths(repoId, fromPath, toPath, maxPaths = 10, maxDepth = 20) {
  const [edges, validNodes] = await Promise.all([loadEdges(repoId), loadNodePaths(repoId)]);
  const { forward } = buildAdjacency(edges, validNodes);
  const paths = [];
  const visited = new Set([fromPath]);
  const stack = [fromPath];
  const dfs = () => {
    if (paths.length >= maxPaths) return;
    const current = stack[stack.length - 1];
    if (current === toPath && stack.length > 1) {
      paths.push([...stack]);
      return;
    }
    if (stack.length >= maxDepth) return;
    for (const next of (forward.get(current) || [])) {
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(next);
      dfs();
      stack.pop();
      visited.delete(next);
      if (paths.length >= maxPaths) return;
    }
  };
  dfs();
  paths.sort((a, b) => a.length - b.length);
  return paths;
}

/**
 * Attack paths — DFS from each `source`-classified node to any
 * `sink`-classified node over the (forward) import graph. `'both'` nodes
 * count as both seeds and targets. When a sink is reached we record the
 * path AND continue exploring past it, because a 'both'-classified node
 * mid-path may have outgoing edges leading to further sinks; the
 * dependency-graph UI's DFS does the same. Matches the on-graph behaviour
 * exactly.
 */
async function getAttackPaths(repoId, { source, sink, maxPaths = 20, maxDepth = 20 } = {}) {
  const [nodes, edges] = await Promise.all([
    loadNodes(repoId, 'file_path, node_classification'),
    loadEdges(repoId),
  ]);
  const validNodes = new Set(nodes.map((n) => n.file_path));
  const { forward } = buildAdjacency(edges, validNodes);
  const sources = nodes
    .filter((n) => n.node_classification === 'source' || n.node_classification === 'both')
    .map((n) => n.file_path)
    .filter((p) => !source || p === source)
    // Sort so that when `maxPaths` truncates we always drop the same paths
    // — loadNodes has no ORDER BY and Postgres can return rows in any order
    // across requests.
    .sort();
  const sinkSet = new Set(
    nodes
      .filter((n) => n.node_classification === 'sink' || n.node_classification === 'both')
      .map((n) => n.file_path)
      .filter((p) => !sink || p === sink)
  );

  const paths = [];
  let truncated = false;

  for (const src of sources) {
    if (paths.length >= maxPaths) { truncated = true; break; }
    const visited = new Set([src]);
    const stack = [src];
    const dfs = () => {
      if (paths.length >= maxPaths) return;
      const current = stack[stack.length - 1];
      // Record when we land on a sink — but DO NOT return. A 'both'-node
      // mid-path may have further sinks downstream.
      if (current !== src && sinkSet.has(current)) {
        paths.push([...stack]);
        if (paths.length >= maxPaths) return;
      }
      // Depth-prune AFTER recording so a node exactly at maxDepth can still
      // register as a sink.
      if (stack.length >= maxDepth) return;
      for (const next of (forward.get(current) || [])) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
        dfs();
        stack.pop();
        visited.delete(next);
        if (paths.length >= maxPaths) return;
      }
    };
    dfs();
  }
  paths.sort((a, b) => a.length - b.length);
  return { paths, truncated };
}

module.exports = {
  getGraphOverview,
  getFileMetrics,
  getBlastRadius,
  getDependents,
  getImports,
  findPaths,
  getAttackPaths,
  // exported for tests
  _countCycles: countCycles,
  _buildAdjacency: buildAdjacency,
};
