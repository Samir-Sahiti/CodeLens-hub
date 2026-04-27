const { supabaseAdmin } = require('../db/supabase');

const DEFAULT_THRESHOLD = 0.92;
const MIN_CHUNK_LINES = 10;
const EXCERPT_LINES = 8;
const EXCERPT_CHARS = 200;

function chunkLineSpan(chunk = {}) {
  const start = Number(chunk.start_line || 0);
  const end = Number(chunk.end_line || 0);
  if (!start || !end || end < start) return 0;
  return end - start + 1;
}

function makeExcerpt(content = '') {
  const lines = String(content || '').split(/\r?\n/).slice(0, EXCERPT_LINES).join('\n');
  return lines.length > EXCERPT_CHARS ? `${lines.slice(0, EXCERPT_CHARS)}...` : lines;
}

function canonicalPair(id1, id2) {
  if (!id1 || !id2 || id1 === id2) return null;
  return String(id1) < String(id2)
    ? { chunk_a_id: id1, chunk_b_id: id2 }
    : { chunk_a_id: id2, chunk_b_id: id1 };
}

function normalizeCandidate(row, repoId, threshold = DEFAULT_THRESHOLD) {
  const similarity = Number(row?.similarity);
  if (!Number.isFinite(similarity) || similarity <= threshold) return null;

  const pair = canonicalPair(row.chunk_a_id, row.chunk_b_id);
  if (!pair) return null;

  return {
    repo_id: repoId,
    chunk_a_id: pair.chunk_a_id,
    chunk_b_id: pair.chunk_b_id,
    similarity,
  };
}

function dedupeCandidates(rows, repoId, threshold = DEFAULT_THRESHOLD) {
  const byPair = new Map();
  for (const row of rows || []) {
    const candidate = normalizeCandidate(row, repoId, threshold);
    if (!candidate) continue;
    const key = `${candidate.chunk_a_id}:${candidate.chunk_b_id}`;
    const existing = byPair.get(key);
    if (!existing || candidate.similarity > existing.similarity) {
      byPair.set(key, candidate);
    }
  }
  return [...byPair.values()];
}

async function detectDuplicateCandidates(repoId, { threshold = DEFAULT_THRESHOLD } = {}) {
  try {
    await supabaseAdmin.from('duplication_candidates').delete().eq('repo_id', repoId);

    const { data: pairs, error } = await supabaseAdmin.rpc('find_duplicate_chunk_pairs', {
      p_repo_id: repoId,
      p_threshold: threshold,
    });

    if (error) {
      console.warn(`[duplication] Similarity search failed for ${repoId}: ${error.message}`);
      return { inserted: 0, skipped: true };
    }

    const candidates = dedupeCandidates(pairs || [], repoId, threshold);
    if (candidates.length === 0) {
      return { inserted: 0, skipped: false };
    }

    const ids = [...new Set(candidates.flatMap(c => [c.chunk_a_id, c.chunk_b_id]))];
    const { data: chunks, error: chunkError } = await supabaseAdmin
      .from('code_chunks')
      .select('id, repo_id, start_line, end_line, embedding')
      .eq('repo_id', repoId)
      .in('id', ids);

    if (chunkError) {
      console.warn(`[duplication] Candidate verification failed for ${repoId}: ${chunkError.message}`);
      return { inserted: 0, skipped: true };
    }

    const chunkById = new Map((chunks || []).map(chunk => [chunk.id, chunk]));
    const verified = candidates.filter(candidate => {
      const a = chunkById.get(candidate.chunk_a_id);
      const b = chunkById.get(candidate.chunk_b_id);
      return a && b
        && a.repo_id === repoId
        && b.repo_id === repoId
        && a.embedding
        && b.embedding
        && chunkLineSpan(a) >= MIN_CHUNK_LINES
        && chunkLineSpan(b) >= MIN_CHUNK_LINES;
    });

    if (verified.length === 0) {
      return { inserted: 0, skipped: false };
    }

    const { error: insertError } = await supabaseAdmin
      .from('duplication_candidates')
      .upsert(verified, { onConflict: 'repo_id,chunk_a_id,chunk_b_id', ignoreDuplicates: false });

    if (insertError) {
      console.warn(`[duplication] Candidate insert failed for ${repoId}: ${insertError.message}`);
      return { inserted: 0, skipped: true };
    }

    return { inserted: verified.length, skipped: false };
  } catch (err) {
    console.warn(`[duplication] Detection failed for ${repoId}: ${err.message}`);
    return { inserted: 0, skipped: true };
  }
}

class UnionFind {
  constructor() {
    this.parent = new Map();
  }

  add(value) {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value) {
    this.add(value);
    const parent = this.parent.get(value);
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(a, b) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

function severityForCluster(memberCount, totalLines) {
  if (memberCount >= 4 || totalLines >= 80) return 'high';
  if (memberCount === 3 || totalLines >= 40) return 'medium';
  return 'low';
}

function buildClusterObjects(pairs, chunksById) {
  const uf = new UnionFind();
  for (const pair of pairs) {
    uf.union(pair.chunk_a_id, pair.chunk_b_id);
  }

  const groupedIds = new Map();
  for (const id of chunksById.keys()) {
    const root = uf.find(id);
    if (!groupedIds.has(root)) groupedIds.set(root, new Set());
    groupedIds.get(root).add(id);
  }

  const pairSimilaritiesByRoot = new Map();
  for (const pair of pairs) {
    const root = uf.find(pair.chunk_a_id);
    if (!pairSimilaritiesByRoot.has(root)) pairSimilaritiesByRoot.set(root, []);
    pairSimilaritiesByRoot.get(root).push(Number(pair.similarity || 0));
  }

  return [...groupedIds.entries()]
    .map(([root, ids], index) => {
      const members = [...ids]
        .map(id => chunksById.get(id))
        .filter(Boolean)
        .sort((a, b) => {
          const byPath = String(a.file_path || '').localeCompare(String(b.file_path || ''));
          if (byPath !== 0) return byPath;
          return Number(a.start_line || 0) - Number(b.start_line || 0);
        })
        .map(chunk => ({
          chunk_id: chunk.id,
          file_path: chunk.file_path,
          start_line: chunk.start_line,
          end_line: chunk.end_line,
          line_count: chunkLineSpan(chunk),
          content: chunk.content || '',
          excerpt: makeExcerpt(chunk.content || ''),
        }));

      const similarities = pairSimilaritiesByRoot.get(root) || [];
      const totalLines = members.reduce((sum, member) => sum + member.line_count, 0);
      return {
        id: `dup-${index + 1}`,
        severity: severityForCluster(members.length, totalLines),
        member_count: members.length,
        total_lines: totalLines,
        similarity_min: similarities.length ? Math.min(...similarities) : 0,
        similarity_max: similarities.length ? Math.max(...similarities) : 0,
        members,
      };
    })
    .filter(cluster => cluster.members.length >= 2)
    .sort((a, b) => {
      const severityRank = { high: 3, medium: 2, low: 1 };
      const bySeverity = severityRank[b.severity] - severityRank[a.severity];
      if (bySeverity !== 0) return bySeverity;
      return b.total_lines - a.total_lines;
    });
}

async function buildDuplicationClusters(repoId) {
  const { data: pairs, error } = await supabaseAdmin
    .from('duplication_candidates')
    .select('id, repo_id, chunk_a_id, chunk_b_id, similarity')
    .eq('repo_id', repoId);

  if (error) throw new Error(`Failed to fetch duplication candidates: ${error.message}`);
  if (!pairs || pairs.length === 0) return [];

  const ids = [...new Set(pairs.flatMap(pair => [pair.chunk_a_id, pair.chunk_b_id]))];
  const { data: chunks, error: chunkError } = await supabaseAdmin
    .from('code_chunks')
    .select('id, repo_id, file_path, start_line, end_line, content')
    .eq('repo_id', repoId)
    .in('id', ids);

  if (chunkError) throw new Error(`Failed to fetch duplicate chunks: ${chunkError.message}`);

  const chunksById = new Map((chunks || []).map(chunk => [chunk.id, chunk]));
  const sameRepoPairs = (pairs || []).filter(pair => (
    chunksById.has(pair.chunk_a_id) && chunksById.has(pair.chunk_b_id)
  ));

  return buildClusterObjects(sameRepoPairs, chunksById);
}

module.exports = {
  DEFAULT_THRESHOLD,
  MIN_CHUNK_LINES,
  canonicalPair,
  dedupeCandidates,
  detectDuplicateCandidates,
  buildDuplicationClusters,
  _private: {
    chunkLineSpan,
    makeExcerpt,
    buildClusterObjects,
    severityForCluster,
  },
};
