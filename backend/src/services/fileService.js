/**
 * File service — read indexed file contents.
 *
 * Backs `GET /api/repos/:repoId/file` and the `read_file` agent tool.
 * Primary source is the `file_contents` table (US-043); falls back to
 * concatenating `code_chunks` for repos indexed before US-043.
 *
 * Returns `{ content, language }` or null if the file is not indexed.
 */

const { supabaseAdmin } = require('../db/supabase');

async function readFile(repoId, filePath, { startLine, endLine } = {}) {
  if (!repoId || !filePath) return null;

  const { data: node } = await supabaseAdmin
    .from('graph_nodes')
    .select('language')
    .eq('repo_id', repoId)
    .eq('file_path', filePath)
    .maybeSingle();

  let content = null;

  const { data: fc, error: fcErr } = await supabaseAdmin
    .from('file_contents')
    .select('content')
    .eq('repo_id', repoId)
    .eq('file_path', filePath)
    .maybeSingle();

  if (!fcErr && fc) {
    content = fc.content;
  } else {
    const { data: chunks, error } = await supabaseAdmin
      .from('code_chunks')
      .select('content, start_line')
      .eq('repo_id', repoId)
      .eq('file_path', filePath)
      .order('start_line', { ascending: true });
    if (error) throw new Error(`code_chunks fetch failed: ${error.message}`);
    if (!chunks || chunks.length === 0) return null;
    content = chunks.map((c) => c.content).join('');
  }

  if (content == null) return null;

  if (typeof startLine === 'number' || typeof endLine === 'number') {
    const lines = content.split('\n');
    const from = Math.max(1, startLine || 1);
    const to = Math.min(lines.length, endLine || lines.length);
    content = lines.slice(from - 1, to).join('\n');
  }

  return { content, language: node?.language || null };
}

module.exports = { readFile };
