import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeSnapshot } from '../lib/snapshotRepo';

describe('snapshotRepo', () => {
  const repoId = '00000000-0000-0000-0000-000000000000';

  it('zero-row repo: matches JSON shape contracts exactly for empty data', async () => {
    // Mock Supabase client
    const db = {
      from: vi.fn().mockImplementation((table) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: table === 'repositories' ? { file_count: 0 } : null }),
          upsert: vi.fn().mockReturnThis()
        };

        // For list endpoints, return empty array
        if (table !== 'repositories' && table !== 'repo_metrics_daily') {
          query.eq = vi.fn().mockResolvedValue({ data: [] });
        }

        if (table === 'repo_metrics_daily') {
          query.upsert = vi.fn().mockReturnThis();
          query.select = vi.fn().mockReturnThis();
          query.single = vi.fn().mockResolvedValue({ data: { success: true } });
        }

        return query;
      })
    };

    // We modify computeSnapshot to return the payload if upsert result is empty in test
    const result = await computeSnapshot(repoId, db);

    expect(result.file_count).toBe(0);
    expect(result.total_loc).toBe(0);
    expect(result.avg_complexity).toBe(0);
    expect(result.max_complexity).toBe(0);

    expect(result.issue_counts_json).toEqual({
      by_type: {
        god_file: 0,
        circular_dependency: 0,
        high_coupling: 0,
        dead_code: 0,
        hardcoded_secret: 0,
        insecure_pattern: 0,
        missing_auth: 0,
        vulnerable_dependency: 0,
        refactoring_candidate: 0
      },
      by_severity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      }
    });

    expect(result.vulnerability_counts_json).toEqual({
      by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
      by_package: []
    });

    expect(result.dependency_counts_json).toEqual({
      total: 0,
      direct: 0,
      transitive: 0,
      vulnerable: 0
    });

    expect(result.top_risks_json).toEqual([]);
  });

  it('idempotency: upsert twice with same repoId and snapshot_date', async () => {
    // We simulate a basic in-memory table to assert UPSERT behavior
    let metricsTable = [];
    
    const db = {
      from: vi.fn().mockImplementation((table) => {
        const query = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [] }),
          single: vi.fn().mockResolvedValue({ data: table === 'repositories' ? { file_count: 5 } : null })
        };

        if (table === 'repo_metrics_daily') {
          query.upsert = vi.fn().mockImplementation((payload, opts) => {
            // Simulate UPSERT on repo_id, snapshot_date
            const index = metricsTable.findIndex(r => r.repo_id === payload.repo_id && r.snapshot_date === payload.snapshot_date);
            if (index > -1) {
              metricsTable[index] = { ...metricsTable[index], ...payload };
            } else {
              metricsTable.push(payload);
            }
            return query;
          });
          query.select = vi.fn().mockReturnThis();
          query.single = vi.fn().mockResolvedValue({ data: { success: true } });
        }

        return query;
      })
    };

    await computeSnapshot(repoId, db);
    await computeSnapshot(repoId, db);

    // Assert only 1 row exists
    const rowCount = metricsTable.filter(r => r.repo_id === repoId).length;
    expect(rowCount).toBe(1);
  });
});
