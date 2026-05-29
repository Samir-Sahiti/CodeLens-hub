const { EventEmitter } = require('events');

const emitter = globalThis.__CODELENS_NOTIFICATION_EMITTER__ || new EventEmitter();
globalThis.__CODELENS_NOTIFICATION_EMITTER__ = emitter;

function emitPrReviewReady(payload) {
  const event = {
    type: 'pr_review.ready',
    payload,
    created_at: new Date().toISOString(),
  };
  if (Array.isArray(globalThis.__CODELENS_NOTIFICATION_EVENTS__)) {
    globalThis.__CODELENS_NOTIFICATION_EVENTS__.push(event);
  }
  emitter.emit('pr_review.ready', event);
  return event;
}

module.exports = { emitter, emitPrReviewReady };
