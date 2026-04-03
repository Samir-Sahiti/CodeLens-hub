const { OpenAI } = require('openai');

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

/**
 * Run a natural language query against an indexed repo using RAG.
 *
 * Steps:
 * 1. Embed the query
 * 2. Retrieve top-k relevant code chunks from Supabase vector store
 * 3. Build a prompt with retrieved context
 * 4. Call Groq and return the response with source references
 *
 * @param {string} repoId
 * @param {string} query
 * @returns {{ answer: string, sources: string[] }}
 */
const searchCodebase = async (repoId, query) => {
  // TODO: implement embedding retrieval + Groq call
  throw new Error('RAG pipeline not yet implemented');
};

module.exports = { searchCodebase, client };
