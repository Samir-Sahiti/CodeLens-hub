const { parseRepository } = require('../parsers/repositoryParser');
const { supabase } = require('../middleware/auth');

/**
 * Full indexing pipeline for a repository.
 * 1. Fetch file tree from GitHub
 * 2. Parse each file with Tree-sitter (AST → dependency edges)
 * 3. Store graph nodes/edges and file chunks in Supabase
 *
 * @param {string} repoId  - Internal repo UUID
 * @param {string} owner   - GitHub owner
 * @param {string} name    - GitHub repo name
 * @param {string} token   - GitHub access token
 */
const indexRepository = async (repoId, owner, name, token) => {
  // TODO: implement full pipeline
  console.log(`[indexer] Starting indexing for ${owner}/${name}`);
};

module.exports = { indexRepository };
