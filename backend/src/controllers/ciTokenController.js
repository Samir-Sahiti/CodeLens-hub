/**
 * US-076 — per-repo CI API token management.
 *
 * Tokens are shown once on creation and stored only as an HMAC-SHA256 hash
 * (see middleware/ciTokenAuth.js). They are scoped to a single repo and used
 * only by the CI status-check endpoint.
 */
const crypto = require('crypto');
const { supabaseAdmin } = require('../db/supabase');
const { canAccessRepo } = require('../lib/repoAccess');
const { hashCiToken } = require('../middleware/ciTokenAuth');

const TOKEN_PREFIX = 'codelens_pat_';

// POST /api/repos/:repoId/ci-tokens  body: { name? }
const createCiToken = async (req, res) => {
  const { repoId } = req.params;
  const name = String(req.body?.name || '').trim().slice(0, 100) || 'CI token';

  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  if (!process.env.CI_TOKEN_HMAC_SECRET) {
    return res.status(500).json({ error: 'CI token generation is not configured on this server' });
  }

  const token = TOKEN_PREFIX + crypto.randomBytes(24).toString('hex');
  const tokenHash = hashCiToken(token);

  const { data, error } = await supabaseAdmin
    .from('repo_api_tokens')
    .insert({ repo_id: repoId, token_hash: tokenHash, name, created_by: req.user.id })
    .select('id, name, created_at')
    .single();

  if (error) {
    console.error('[ci-tokens.create] Failed:', error.message);
    return res.status(500).json({ error: 'Failed to generate CI token' });
  }

  // The plaintext token is returned exactly once and never persisted.
  return res.status(201).json({ id: data.id, name: data.name, created_at: data.created_at, token });
};

// GET /api/repos/:repoId/ci-tokens — metadata only, never the hash or plaintext
const listCiTokens = async (req, res) => {
  const { repoId } = req.params;
  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const { data, error } = await supabaseAdmin
    .from('repo_api_tokens')
    .select('id, name, created_at, last_used_at, revoked_at')
    .eq('repo_id', repoId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[ci-tokens.list] Failed:', error.message);
    return res.status(500).json({ error: 'Failed to list CI tokens' });
  }
  return res.json({ tokens: data || [] });
};

// DELETE /api/repos/:repoId/ci-tokens/:tokenId — revoke
const revokeCiToken = async (req, res) => {
  const { repoId, tokenId } = req.params;
  const allowed = await canAccessRepo(repoId, req.user.id);
  if (!allowed) return res.status(404).json({ error: 'Repository not found or unauthorized' });

  const { data, error } = await supabaseAdmin
    .from('repo_api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .eq('repo_id', repoId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[ci-tokens.revoke] Failed:', error.message);
    return res.status(500).json({ error: 'Failed to revoke CI token' });
  }
  if (!data) return res.status(404).json({ error: 'Token not found or already revoked' });
  return res.json({ ok: true, id: data.id });
};

module.exports = { createCiToken, listCiTokens, revokeCiToken };
