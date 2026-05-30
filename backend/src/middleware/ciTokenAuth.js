const crypto = require('crypto');
const { supabaseAdmin } = require('../db/supabase');

/**
 * Hash a CI token the same way it is stored: HMAC-SHA256 with a server secret.
 * Deterministic so the per-request lookup is a single indexed query on
 * repo_api_tokens.token_hash. The plaintext token is never stored.
 */
function hashCiToken(token) {
  const secret = process.env.CI_TOKEN_HMAC_SECRET || '';
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * Authenticates a per-repo CI token (US-076). Expects:
 *   Authorization: Bearer codelens_pat_<token>
 * Resolves the token to a single repo and enforces that it matches :repoId in
 * the route. On success sets req.ciAuth = { repoId, tokenId, scope: 'ci_check' }.
 * This is a parallel to requireAuth, but it resolves a repo rather than a user.
 */
const requireCiToken = async (req, res, next) => {
  try {
    if (!process.env.CI_TOKEN_HMAC_SECRET) {
      console.error('[ciTokenAuth] CI_TOKEN_HMAC_SECRET is not configured');
      return res.status(500).json({ error: 'CI token verification is not configured on this server' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token.startsWith('codelens_pat_')) {
      return res.status(401).json({ error: 'Invalid CI token' });
    }

    const tokenHash = hashCiToken(token);
    const { data: row, error } = await supabaseAdmin
      .from('repo_api_tokens')
      .select('id, repo_id, revoked_at')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle();

    if (error) {
      console.error('[ciTokenAuth] token lookup failed:', error.message);
      return res.status(500).json({ error: 'Failed to verify CI token' });
    }
    if (!row) {
      return res.status(401).json({ error: 'Invalid or revoked CI token' });
    }

    // Scope: a CI token may only act on the repo it was issued for.
    if (req.params.repoId && row.repo_id !== req.params.repoId) {
      return res.status(403).json({ error: 'CI token is not authorized for this repository' });
    }

    req.ciAuth = { repoId: row.repo_id, tokenId: row.id, scope: 'ci_check' };

    // Fire-and-forget usage stamp; never blocks the request.
    supabaseAdmin
      .from('repo_api_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', row.id)
      .then(() => {}, (err) => console.warn('[ciTokenAuth] failed to stamp last_used_at:', err?.message || err));

    next();
  } catch (err) {
    console.error('[ciTokenAuth] unexpected error:', err);
    return res.status(500).json({ error: 'Failed to verify CI token' });
  }
};

module.exports = { requireCiToken, hashCiToken };
