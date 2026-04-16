const { OpenAI } = require('openai');

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

/**
 * Run a natural language query against an indexed repo using RAG.
 *
 * Steps:
 * 1. Embed the query (OpenAI text-embedding-3-small)
 * 2. Retrieve top-k relevant code chunks from Supabase vector store (cosine similarity)
 * 3. Build a prompt with retrieved context
 * 4. Call OpenAI (gpt-4-turbo) and return the response with source references
 *
 * @param {string} repoId
 * @param {string} query
 * @returns {{ answer: string, sources: string[] }}
 */
const searchCodebase = async (_repoId, _query) => {
  // TODO: US-019 — logic for embedding retrieval and gpt-4-turbo call
  throw new Error('RAG pipeline not yet fully implemented');
};

module.exports = { searchCodebase, client };
