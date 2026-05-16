/**
 * Start Here tour generation (US-059).
 *
 * Auto-generates a 6-step onboarding tour at the end of indexing using a pure
 * graph heuristic (no RAG): pick the most-imported source file as the start
 * node, then walk forward through graph_edges preferring nodes with the
 * highest (incoming_count + complexity_score). The pipeline calls this
 * fire-and-forget — failures are logged but never block indexing.
 */

const { supabaseAdmin } = require('../db/supabase');
const { explainSteps }  = require('../controllers/toursController');

const MIN_GRAPH_NODES = 4;
const MAX_STEPS       = 6;
const TITLE           = 'Start Here';
const DESCRIPTION     = "An auto-generated walkthrough of this repo's most important files.";
const SYSTEM_PROMPT   =
  'You are a senior software engineer writing onboarding tour steps for a developer ' +
  'opening this codebase for the first time. Keep each step short, concrete, and ' +
  'focused on what role the file plays in the overall architecture.';

function buildOnboardingPrompt({ filePath, index, total, excerpt }) {
  return (
    `You are writing step ${index + 1} of ${total} in an onboarding tour through this codebase. ` +
    `The current step is the file \`${filePath}\`. ` +
    (excerpt
      ? `Here's a representative excerpt:\n\n${excerpt}\n\n`
      : 'No source excerpt is available for this file.\n\n') +
    'Explain in 2–3 sentences why this file matters in the architecture and what role it plays. ' +
    'Do not enumerate every export — focus on the big picture so a new joiner knows why this file is on the tour.'
  );
}

/**
 * Pick the start node and walk forward through the graph.
 * Pure function, easy to unit test.
 *
 * @param {{file_path:string, incoming_count:number, complexity_score:number, node_classification:string|null}[]} nodes
 * @param {{from_path:string, to_path:string}[]} edges
 * @param {number} [maxSteps]
 * @returns {string[]} ordered file paths (length 0..maxSteps)
 */
function buildStartHereWalk(nodes, edges, maxSteps = MAX_STEPS) {
  if (!nodes || nodes.length === 0) return [];

  const sortByImportance = (a, b) =>
    (b.incoming_count || 0) - (a.incoming_count || 0)
    || (b.complexity_score || 0) - (a.complexity_score || 0);

  const sources = nodes.filter(
    (n) => n.node_classification === 'source' || n.node_classification === 'both'
  );
  const pool = sources.length > 0 ? sources : nodes;
  const startNode = [...pool].sort(sortByImportance)[0];
  if (!startNode) return [];

  const nodeByPath = new Map(nodes.map((n) => [n.file_path, n]));
  const adjacency  = new Map();
  for (const edge of edges || []) {
    if (!edge.from_path || !edge.to_path) continue;
    if (!adjacency.has(edge.from_path)) adjacency.set(edge.from_path, []);
    adjacency.get(edge.from_path).push(edge.to_path);
  }

  const visited = new Set([startNode.file_path]);
  const result  = [startNode.file_path];

  while (result.length < maxSteps) {
    const current = result[result.length - 1];
    const candidates = (adjacency.get(current) || [])
      .filter((p) => !visited.has(p) && nodeByPath.has(p))
      .map((p) => nodeByPath.get(p))
      .sort(sortByImportance);

    if (candidates.length === 0) break;
    const next = candidates[0];
    visited.add(next.file_path);
    result.push(next.file_path);
  }

  return result;
}

/**
 * Generate (or regenerate) the Start Here tour for a repo. Fire-and-forget
 * from the indexing pipeline.
 *
 * @param {{repoId: string, userId: string}} args  userId is the repo owner; budget is charged to them.
 * @returns {Promise<{skipped?: boolean, reason?: string, tourId?: string, stepCount?: number}>}
 */
async function generateStartHereTour({ repoId, userId }) {
  if (!repoId || !userId) {
    return { skipped: true, reason: 'missing_args' };
  }

  try {
    const { data: nodes, error: nodesErr } = await supabaseAdmin
      .from('graph_nodes')
      .select('file_path, incoming_count, complexity_score, node_classification')
      .eq('repo_id', repoId);
    if (nodesErr) throw nodesErr;

    if (!nodes || nodes.length < MIN_GRAPH_NODES) {
      console.log(`[start-here] skipping — only ${nodes?.length || 0} graph nodes (min ${MIN_GRAPH_NODES})`);
      return { skipped: true, reason: 'too_small' };
    }

    const { data: edges, error: edgesErr } = await supabaseAdmin
      .from('graph_edges')
      .select('from_path, to_path')
      .eq('repo_id', repoId);
    if (edgesErr) throw edgesErr;

    const walk = buildStartHereWalk(nodes, edges || [], MAX_STEPS);
    if (walk.length === 0) {
      console.log('[start-here] skipping — no walkable start node');
      return { skipped: true, reason: 'no_start_node' };
    }

    const { steps } = await explainSteps({
      filePaths:       walk,
      repoId,
      userId,
      systemPrompt:    SYSTEM_PROMPT,
      buildUserPrompt: buildOnboardingPrompt,
      maxTokens:       250,
    });

    if (steps.length === 0) {
      console.warn('[start-here] no steps produced (likely budget exhausted) — skipping persist');
      return { skipped: true, reason: 'budget_exhausted' };
    }

    // Replace the existing Start Here tour atomically. Delete by (repo_id,
    // is_auto_generated, title) so we don't depend on the previous tour's id.
    // tour_steps cascades on tour delete.
    const { error: delErr } = await supabaseAdmin
      .from('tours')
      .delete()
      .eq('repo_id', repoId)
      .eq('is_auto_generated', true)
      .eq('title', TITLE);
    if (delErr) {
      console.warn('[start-here] failed to clear previous Start Here tour:', delErr.message);
    }

    const { data: tour, error: insertErr } = await supabaseAdmin
      .from('tours')
      .insert({
        repo_id:           repoId,
        created_by:        userId,
        title:             TITLE,
        description:       DESCRIPTION,
        original_query:    null,
        is_auto_generated: true,
        is_team_shared:    false,
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    const stepRows = steps.map((s, idx) => ({
      tour_id:     tour.id,
      step_order:  idx + 1,
      file_path:   s.file_path,
      start_line:  s.start_line,
      end_line:    s.end_line,
      explanation: s.explanation,
    }));

    const { error: stepsErr } = await supabaseAdmin.from('tour_steps').insert(stepRows);
    if (stepsErr) {
      // Compensating delete so we never leave an empty Start Here tour visible.
      console.error('[start-here] failed to insert steps, rolling back tour:', stepsErr.message);
      await supabaseAdmin.from('tours').delete().eq('id', tour.id);
      throw stepsErr;
    }

    console.log(`[start-here] generated tour ${tour.id} with ${steps.length} steps for repo ${repoId}`);
    return { tourId: tour.id, stepCount: steps.length };
  } catch (err) {
    console.error('[start-here] generation failed:', err.message);
    return { skipped: true, reason: 'error', error: err.message };
  }
}

module.exports = {
  generateStartHereTour,
  buildStartHereWalk,
  _constants: { MIN_GRAPH_NODES, MAX_STEPS, TITLE, DESCRIPTION },
};
