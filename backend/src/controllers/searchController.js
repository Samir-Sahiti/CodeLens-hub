/**
 * Search controller stub
 * Full RAG implementation will be added in Sprint 4 (US-008+).
 */

/** POST /api/search/:repoId — natural language search over an indexed repo */
const search = async (req, res) => {
  // TODO: Sprint 4 — embed req.body.query, run cosine similarity over code_chunks,
  //       pass top-K chunks to Claude for answer synthesis
  res.status(501).json({ error: 'Not implemented' });
};

module.exports = { search };
