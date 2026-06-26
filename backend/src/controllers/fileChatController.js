/**
 * File Chat controller — targeted context (US-033)
 *
 * POST /api/file-chat/:repoId
 *   Body: { filePath: string, query: string, includeImports?: boolean }
 *
 * Behavior:
 * - No embedding / no similarity search (RAG disabled for this session)
 * - Fetch the selected file's content from the DB (assembled from code_chunks)
 * - Optionally include direct imports (graph_edges from_path = filePath)
 * - Stream LLM response via SSE
 */

const { supabaseAdmin } = require('../db/supabase');
const { bindRequestAbort, isAbortError } = require('../lib/sseAbort');
const { streamChatText } = require('../ai/openaiClient');

async function canAccessRepo(repoId, userId) {
  // Owner check
  const { data: owned, error: ownedErr } = await supabaseAdmin
    .from('repositories')
    .select('id')
    .eq('id', repoId)
    .eq('user_id', userId)
    .maybeSingle();
  if (ownedErr) throw new Error(ownedErr.message);
  if (owned) return true;

  // Team membership check
  const { data: memberships, error: membershipsErr } = await supabaseAdmin
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId);
  if (membershipsErr) throw new Error(membershipsErr.message);
  const teamIds = (memberships || []).map((m) => m.team_id);
  if (teamIds.length === 0) return false;

  const { data: teamRepo, error: teamRepoErr } = await supabaseAdmin
    .from('team_repositories')
    .select('repo_id')
    .eq('repo_id', repoId)
    .in('team_id', teamIds)
    .maybeSingle();
  if (teamRepoErr) throw new Error(teamRepoErr.message);

  return !!teamRepo;
}

async function fetchFileFromChunks(repoId, filePath) {
  const { data, error } = await supabaseAdmin
    .from('code_chunks')
    .select('file_path, start_line, end_line, content')
    .eq('repo_id', repoId)
    .eq('file_path', filePath)
    .order('start_line', { ascending: true });

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return null;

  // We don't attempt perfect reconstruction; we provide the file as a stitched
  // context block assembled from stored chunks.
  const stitched = data
    .map((r) => r.content)
    .filter(Boolean)
    .join('\n\n');

  const maxEnd = Math.max(...data.map((r) => r.end_line || 0));

  return {
    file_path: filePath,
    start_line: 1,
    end_line: maxEnd || null,
    content: stitched,
  };
}

function buildSystemContext(primaryFile, importedFiles) {
  const blocks = [];

  blocks.push([
    `--- FILE: ${primaryFile.file_path}${primaryFile.end_line ? ` (approx lines 1–${primaryFile.end_line})` : ''} ---`,
    primaryFile.content,
  ].join('\n'));

  for (const f of importedFiles) {
    blocks.push([
      `--- DIRECT IMPORT: ${f.file_path}${f.end_line ? ` (approx lines 1–${f.end_line})` : ''} ---`,
      f.content,
    ].join('\n'));
  }

  return blocks.join('\n\n');
}

function formatSource(file) {
  const lines = (file.content || '').split('\n');
  const excerpt = lines.slice(0, 2).join('\n');
  return {
    file_path: file.file_path,
    start_line: file.start_line || 1,
    end_line: file.end_line || null,
    excerpt,
    full_content: file.content,
  };
}

const chatWithFile = async (req, res) => {
  const { repoId } = req.params;
  const { filePath, query, includeImports } = req.body || {};

  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'filePath is required' });
  }
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'query is required' });
  }

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    if (!process.env.OPENAI_API_KEY) {
      send({ type: 'error', message: 'File chat is not available: OpenAI API key not configured.' });
      return res.end();
    }

    const primary = await fetchFileFromChunks(repoId, filePath);
    if (!primary || !primary.content) {
      send({ type: 'error', message: 'This file is not available in the index yet. Try re-indexing the repository.' });
      return res.end();
    }

    const importedFiles = [];
    if (includeImports) {
      const { data: edges, error: edgesErr } = await supabaseAdmin
        .from('graph_edges')
        .select('to_path')
        .eq('repo_id', repoId)
        .eq('from_path', filePath)
        .limit(10);
      if (edgesErr) throw new Error(edgesErr.message);

      const importPaths = Array.from(new Set((edges || []).map((e) => e.to_path).filter(Boolean)));
      // Keep context bounded.
      const MAX_CONTEXT_CHARS = 24000;
      let totalChars = (primary.content || '').length;

      for (const p of importPaths) {
        if (p === filePath) continue;
        const imported = await fetchFileFromChunks(repoId, p);
        if (!imported?.content) continue;
        const nextLen = imported.content.length;
        if (totalChars + nextLen > MAX_CONTEXT_CHARS) break;
        importedFiles.push(imported);
        totalChars += nextLen;
      }
    }

    // Send sources immediately.
    send({ type: 'sources', sources: [formatSource(primary), ...importedFiles.map(formatSource)] });

    const systemContext = buildSystemContext(primary, importedFiles);
    const system = [
      'You are a senior software engineer helping a developer understand a single file.',
      'Answer the user\'s question using ONLY the code provided in the system context.',
      'Do not use any other repository context, memory, or outside knowledge.',
      'If the answer is not supported by the provided code, say so clearly and suggest what to inspect next.',
      'When you reference code, cite file paths and (approximate) line numbers when possible.',
    ].join(' ');

    const { signal, cleanup } = bindRequestAbort(req);
    let aborted = false;
    try {
      await streamChatText({
        system: `${system}\n\n${systemContext}`,
        user: query.trim(),
        maxTokens: 1500,
        signal,
        onDelta: (frag) => send({ type: 'chunk', text: frag }),
      });
    } catch (streamErr) {
      if (isAbortError(streamErr, signal)) {
        aborted = true;
        console.warn('[fileChat] LLM stream aborted by client disconnect');
      } else {
        throw streamErr;
      }
    } finally {
      cleanup();
    }

    if (!aborted) send({ type: 'done' });
    res.end();
  } catch (err) {
    console.error('[fileChat] Error:', err);
    try {
      send({ type: 'error', message: 'An unexpected error occurred. Please try again.' });
      res.end();
    } catch {
      res.end();
    }
  }
};

module.exports = { chatWithFile };
