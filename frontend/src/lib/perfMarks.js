/**
 * Lightweight performance instrumentation (Phase 0).
 *
 * Wraps the browser's User Timing API in a no-throw helper. Marks are kept
 * cheap so we can sprinkle them on hot paths without a perf penalty in prod.
 * In dev, completed measures are console.debug'd so they're visible without
 * opening the Performance tab.
 *
 *   mark('analysis-fetch:start');
 *   ...
 *   measure('analysis-fetch', 'analysis-fetch:start');
 *
 * The single-arg variant `measure(name)` measures from `${name}:start` to now.
 */

const isBrowser = typeof window !== 'undefined' && typeof window.performance !== 'undefined';
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

export function mark(name) {
  if (!isBrowser || !window.performance.mark) return;
  try { window.performance.mark(name); } catch { /* ignore */ }
}

export function measure(name, startMark = `${name}:start`, endMark) {
  if (!isBrowser || !window.performance.measure) return null;
  try {
    const entry = window.performance.measure(name, startMark, endMark);
    if (isDev && entry?.duration != null) {
      // eslint-disable-next-line no-console
      console.debug(`[perf] ${name}: ${entry.duration.toFixed(1)}ms`);
    }
    return entry;
  } catch {
    return null;
  }
}

/** Convenience: time an async function end-to-end. */
export async function timed(name, fn) {
  mark(`${name}:start`);
  try {
    return await fn();
  } finally {
    measure(name);
  }
}
