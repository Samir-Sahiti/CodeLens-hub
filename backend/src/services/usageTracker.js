/**
 * Usage tracker (US-042)
 * Records per-request token consumption into api_usage.
 * Non-fatal — a failure here never breaks the main request.
 */

const { supabaseAdmin } = require('../db/supabase');

async function recordUsage({ userId, endpoint, provider, promptTokens = 0, completionTokens = 0, embeddingTokens = 0 }) {
  if (!userId) return;
  try {
    await supabaseAdmin.from('api_usage').insert({
      user_id:           userId,
      endpoint,
      provider,
      prompt_tokens:     promptTokens,
      completion_tokens: completionTokens,
      embedding_tokens:  embeddingTokens,
    });
  } catch (err) {
    console.warn('[usageTracker] Failed to record usage:', err.message);
  }
}

module.exports = { recordUsage };
