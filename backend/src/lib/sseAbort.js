/**
 * SSE abort helper (Phase 1.1).
 *
 * Binds a request's `close` event to a new AbortController so upstream calls
 * (Claude SDK, fetch, etc.) can stop generating output once the client
 * disconnects. Without this, every closed-tab kicks off the full output stream
 * to completion while still billing the token output — wasteful at any scale.
 *
 *   const { signal, cleanup, isAborted } = bindRequestAbort(req);
 *   try {
 *     const stream = await anthropic.messages.create({ ... }, { signal });
 *     ...
 *   } finally {
 *     cleanup();
 *   }
 */

function bindRequestAbort(req) {
  const controller = new AbortController();
  const onClose = () => {
    try { controller.abort(); } catch { /* ignore */ }
  };
  if (req && typeof req.on === 'function') {
    req.on('close', onClose);
  }
  const cleanup = () => {
    if (req && typeof req.off === 'function') {
      req.off('close', onClose);
    }
  };
  return {
    signal: controller.signal,
    isAborted: () => controller.signal.aborted,
    cleanup,
  };
}

/** Classifies a thrown error as an abort, matching both the Anthropic SDK and undici flavours. */
function isAbortError(err, signal) {
  if (!err) return false;
  if (signal && signal.aborted) return true;
  if (err.name === 'AbortError') return true;
  if (err.code === 'ABORT_ERR') return true;
  return false;
}

module.exports = { bindRequestAbort, isAbortError };
