/**
 * Database helpers (Phase 1 — performance roadmap).
 *
 * Two utilities:
 *   - SAFE_FETCH_CEILING: explicit row limit applied to every "fetch all rows
 *     for a repo" select. PostgREST silently caps unbounded selects at 1000;
 *     this constant raises that cap and gives us a single knob to tune.
 *   - warnIfCeilingHit: surfaces silent truncation as a warning so we notice
 *     when a deployment outgrows the limit.
 *   - withSupabaseRetry: small retry-with-backoff for critical writes that
 *     should survive transient 5xx / 429 / network errors.
 */

const SAFE_FETCH_CEILING = parseInt(process.env.SUPABASE_FETCH_CEILING || '50000', 10);

function warnIfCeilingHit(label, rows) {
  if (!Array.isArray(rows)) return;
  if (rows.length >= SAFE_FETCH_CEILING) {
    console.warn(`[db] ${label}: hit fetch ceiling of ${SAFE_FETCH_CEILING} rows — pagination required for further growth`);
  }
}

function isRetryableSupabaseError(err) {
  if (!err) return false;
  // Network / undici failures expose a code property.
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'EAI_AGAIN' || err.code === 'ENETUNREACH') return true;
  // PostgREST error shape: { message, code, status }
  const status = err.status || err.statusCode;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;
  // Supabase JS sometimes surfaces fetch failures as plain messages.
  const msg = String(err.message || '').toLowerCase();
  if (msg.includes('fetch failed') || msg.includes('timeout') || msg.includes('socket hang up')) return true;
  return false;
}

async function withSupabaseRetry(fn, { tries = 3, baseMs = 500, label = 'supabase-call' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const result = await fn();
      // Supabase returns errors via { error } rather than throwing — bubble up.
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        if (attempt < tries && isRetryableSupabaseError(result.error)) {
          const delay = baseMs * (2 ** (attempt - 1));
          console.warn(`[db] ${label}: retryable error on attempt ${attempt}/${tries} (${result.error.message}); retrying in ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
      return result;
    } catch (err) {
      lastErr = err;
      if (attempt < tries && isRetryableSupabaseError(err)) {
        const delay = baseMs * (2 ** (attempt - 1));
        console.warn(`[db] ${label}: thrown error on attempt ${attempt}/${tries} (${err.message}); retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

module.exports = { SAFE_FETCH_CEILING, warnIfCeilingHit, withSupabaseRetry, isRetryableSupabaseError };
