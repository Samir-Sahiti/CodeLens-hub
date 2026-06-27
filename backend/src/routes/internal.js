const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../db/supabase');

// Middleware to check server secret
const requireServerSecret = (req, res, next) => {
  const secret = req.headers['server-secret'];
  const expected = process.env.CI_TOKEN_HMAC_SECRET;
  // No fallback: if the secret isn't configured the endpoint is closed, not open.
  if (!expected || !secret || secret !== expected) {
    return res.status(401).json({ error: 'Unauthorized: Invalid server-secret header' });
  }
  next();
};

// POST /api/internal/snapshot-daily
router.post('/snapshot-daily', requireServerSecret, async (req, res) => {
  try {
    const { computeSnapshot } = require('../lib/snapshotRepo');
    const { data: repos, error } = await supabaseAdmin
      .from('repositories')
      .select('id')
      .eq('status', 'ready');

    if (error) {
      console.error('[snapshot-daily] DB error fetching repos:', error.message);
      return res.status(500).json({ error: error.message });
    }

    let successCount = 0;
    let failCount = 0;

    for (const repo of repos || []) {
      try {
        await computeSnapshot(repo.id, supabaseAdmin);
        successCount++;
      } catch (e) {
        console.error(`[snapshot-daily] Error for repo ${repo.id}:`, e.message);
        failCount++;
      }
    }

    res.json({ success: true, message: `Daily snapshots generated: ${successCount} succeeded, ${failCount} failed` });
  } catch (err) {
    console.error('[snapshot-daily] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
