/**
 * Per-request observability store (Phase 0).
 *
 * Wires an AsyncLocalStorage that tracks:
 *   - request start time
 *   - per-request Supabase call ledger (table, op, durationMs, status)
 *
 * Used by:
 *   - requestTiming middleware (writes start time, emits summary on response close)
 *   - supabase admin/anon clients (record each network call via custom fetch)
 *
 * Designed to fail open: any error in the store is swallowed so observability
 * never breaks the request path.
 */

const { AsyncLocalStorage } = require('async_hooks');

const requestStore = new AsyncLocalStorage();

function getStore() {
  try {
    return requestStore.getStore() || null;
  } catch {
    return null;
  }
}

/** Records a single Supabase fetch round-trip into the current request's ledger. */
function recordSupabaseCall(entry) {
  const store = getStore();
  if (!store || !Array.isArray(store.supabaseCalls)) return;
  store.supabaseCalls.push(entry);
}

/**
 * Express middleware factory. Initialises the AsyncLocalStorage for the request
 * and emits a single summary log line on response finish. Slow requests
 * (>SLOW_REQUEST_MS) are escalated to console.warn.
 */
function requestTimingMiddleware({ slowRequestMs = 500 } = {}) {
  return function requestTiming(req, res, next) {
    const start = process.hrtime.bigint();
    const store = {
      start,
      supabaseCalls: [],
    };

    requestStore.run(store, () => {
      res.on('finish', () => {
        try {
          const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
          const calls = store.supabaseCalls || [];
          const totalDb = calls.reduce((sum, c) => sum + (c.durationMs || 0), 0);
          const top = calls
            .slice()
            .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
            .slice(0, 3)
            .map(c => `${c.method}:${c.table || c.url || '?'} ${Math.round(c.durationMs)}ms`)
            .join(' | ');

          const userId = req.user?.id ? `user=${req.user.id.slice(0, 8)}` : '';
          const summary = `[req] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms db=${calls.length}@${totalDb.toFixed(0)}ms${top ? ` top=[${top}]` : ''} ${userId}`.trim();

          if (durationMs >= slowRequestMs) {
            console.warn(summary);
          } else if (process.env.LOG_REQUEST_TIMING === 'true') {
            console.log(summary);
          }
        } catch {
          // Never let observability throw inside the response lifecycle.
        }
      });

      next();
    });
  };
}

module.exports = { requestStore, getStore, recordSupabaseCall, requestTimingMiddleware };
