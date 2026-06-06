#!/usr/bin/env node

/**
 * US-081: Daily metrics snapshot job fallback
 * 
 * Runs nightly at 03:00 UTC. If Supabase pg_cron is not available,
 * this script runs via Render cron and hits the internal API endpoint
 * to compute the daily aggregations and insert into repo_metrics_daily.
 */

async function run() {
  const apiUrl = process.env.PUBLIC_API_URL || 'http://localhost:3001';
  const secret = process.env.CI_TOKEN_HMAC_SECRET || 'fallback-secret-for-dev';
  
  console.log(`[snapshot-daily] Triggering snapshot generation at ${apiUrl}/api/internal/snapshot-daily`);
  
  try {
    const res = await fetch(`${apiUrl}/api/internal/snapshot-daily`, {
      method: 'POST',
      headers: {
        'server-secret': secret,
        'Content-Type': 'application/json'
      }
    });
    
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    
    const data = await res.json();
    console.log('[snapshot-daily] Success:', data);
  } catch (err) {
    console.error('[snapshot-daily] Failed to generate snapshots:', err.message);
    process.exit(1);
  }
}

run();
