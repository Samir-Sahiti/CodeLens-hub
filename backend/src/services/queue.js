const pLimit = require('p-limit');

class Queue {
  constructor() {
    this.limit = pLimit(5);
    this.handlers = {};
  }

  process(jobName, handler) {
    this.handlers[jobName] = handler;
  }

  add(jobName, data, options = {}) {
    this.limit(async () => {
      const handler = this.handlers[jobName];
      if (!handler) {
        if (typeof jobName === 'function') {
          // support queue.add(async () => { ... })
          try { await jobName(); } catch (e) { console.error('Queue job failed:', e); }
        }
        return;
      }

      const job = { data };
      
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        if (options.timeout) {
          timeoutId = setTimeout(() => {
            const err = new Error(`Job timeout`);
            err.name = 'TimeoutError';
            reject(err);
          }, options.timeout);
        }
      });

      try {
        await Promise.race([
          handler(job),
          ...(options.timeout ? [timeoutPromise] : [])
        ]);
      } catch (err) {
        if (err.name === 'TimeoutError') {
          console.error(`[Queue] Job timed out`);
          if (data.onTimeout) data.onTimeout(err);
        } else {
          console.error(`[Queue] Job failed:`, err.message);
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    });
  }
}

const queue = new Queue();

const { computeArchDiff } = require('./diffService');
queue.process('pr-diff', async (job) => {
  console.log(`[Queue] Computing PR diff for ${job.data.owner}/${job.data.name} PR #${job.data.prId}`);
  await computeArchDiff(job.data);
});

module.exports = { queue };
