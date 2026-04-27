import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import duplicationScanner from '../src/services/duplicationScanner.js';

const {
  canonicalPair,
  dedupeCandidates,
  detectDuplicateCandidates,
  _private,
} = duplicationScanner;

function makeSupabaseMock({ rpcPairs = [], chunks = [] } = {}) {
  const writes = { upsertPayload: null };

  class Builder {
    constructor(table) {
      this.table = table;
      this.action = 'select';
      this.filters = [];
      this.payload = null;
    }
    select() { return this; }
    delete() { this.action = 'delete'; return this; }
    upsert(payload) { this.action = 'upsert'; this.payload = payload; return this; }
    eq(column, value) { this.filters.push({ column, value }); return this; }
    in(column, value) { this.filters.push({ column, value }); return this; }
    then(resolve, reject) {
      if (this.table === 'duplication_candidates' && this.action === 'delete') {
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
      if (this.table === 'duplication_candidates' && this.action === 'upsert') {
        writes.upsertPayload = this.payload;
        return Promise.resolve({ data: this.payload, error: null }).then(resolve, reject);
      }
      if (this.table === 'code_chunks') {
        const idFilter = this.filters.find(f => f.column === 'id');
        const wanted = new Set(idFilter?.value || []);
        return Promise.resolve({ data: chunks.filter(chunk => wanted.has(chunk.id)), error: null }).then(resolve, reject);
      }
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    }
  }

  return {
    writes,
    client: {
      from: (table) => new Builder(table),
      rpc: async (fnName) => {
        if (fnName === 'find_duplicate_chunk_pairs') return { data: rpcPairs, error: null };
        return { data: null, error: null };
      },
    },
  };
}

describe('duplicationScanner', () => {
  afterEach(() => {
    delete globalThis.__CODELENS_SUPABASE_ADMIN__;
  });

  it('canonicalizes pairs with the lowest id first', () => {
    expect(canonicalPair('b', 'a')).toEqual({ chunk_a_id: 'a', chunk_b_id: 'b' });
    expect(canonicalPair('a', 'b')).toEqual({ chunk_a_id: 'a', chunk_b_id: 'b' });
    expect(canonicalPair('a', 'a')).toBeNull();
  });

  it('uses strict similarity threshold and deduplicates mirrored k-NN pairs', () => {
    const rows = dedupeCandidates([
      { chunk_a_id: 'b', chunk_b_id: 'a', similarity: 0.94 },
      { chunk_a_id: 'a', chunk_b_id: 'b', similarity: 0.95 },
      { chunk_a_id: 'c', chunk_b_id: 'd', similarity: 0.92 },
    ], 'repo-1');

    expect(rows).toEqual([
      { repo_id: 'repo-1', chunk_a_id: 'a', chunk_b_id: 'b', similarity: 0.95 },
    ]);
  });

  it('skips chunks without embeddings and chunks shorter than 10 lines before insert', async () => {
    const { client, writes } = makeSupabaseMock({
      rpcPairs: [
        { chunk_a_id: 'a', chunk_b_id: 'b', similarity: 0.95 },
        { chunk_a_id: 'c', chunk_b_id: 'd', similarity: 0.96 },
      ],
      chunks: [
        { id: 'a', repo_id: 'repo-1', start_line: 1, end_line: 12, embedding: [1] },
        { id: 'b', repo_id: 'repo-1', start_line: 2, end_line: 14, embedding: [1] },
        { id: 'c', repo_id: 'repo-1', start_line: 1, end_line: 9, embedding: [1] },
        { id: 'd', repo_id: 'repo-1', start_line: 1, end_line: 12, embedding: null },
      ],
    });
    globalThis.__CODELENS_SUPABASE_ADMIN__ = client;

    const result = await detectDuplicateCandidates('repo-1');

    expect(result.inserted).toBe(1);
    expect(writes.upsertPayload).toEqual([
      { repo_id: 'repo-1', chunk_a_id: 'a', chunk_b_id: 'b', similarity: 0.95 },
    ]);
  });

  it('groups transitive pairs into one cluster and calculates severity', () => {
    const clusters = _private.buildClusterObjects(
      [
        { chunk_a_id: 'a', chunk_b_id: 'b', similarity: 0.95 },
        { chunk_a_id: 'b', chunk_b_id: 'c', similarity: 0.96 },
      ],
      new Map([
        ['a', { id: 'a', file_path: 'a.js', start_line: 1, end_line: 20, content: 'a\n'.repeat(20) }],
        ['b', { id: 'b', file_path: 'b.js', start_line: 1, end_line: 20, content: 'b\n'.repeat(20) }],
        ['c', { id: 'c', file_path: 'c.js', start_line: 1, end_line: 20, content: 'c\n'.repeat(20) }],
      ])
    );

    expect(clusters).toHaveLength(1);
    expect(clusters[0].member_count).toBe(3);
    expect(clusters[0].severity).toBe('medium');
    expect(clusters[0].members.map(m => m.chunk_id)).toEqual(['a', 'b', 'c']);
  });

  it('schema and migration define same-repo-safe duplicate storage and RPC behavior', () => {
    const root = path.resolve(__dirname, '..', '..');
    const schema = fs.readFileSync(path.join(root, 'scripts/schema.sql'), 'utf8');
    const migration = fs.readFileSync(path.join(root, 'backend/migrations/20260427_us052_duplication_candidates.sql'), 'utf8');

    for (const sql of [schema, migration]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS duplication_candidates');
      expect(sql).toContain('UNIQUE (repo_id, chunk_a_id, chunk_b_id)');
      expect(sql).toContain('CHECK (chunk_a_id < chunk_b_id)');
      expect(sql).toContain('CREATE OR REPLACE FUNCTION find_duplicate_chunk_pairs');
      expect(sql).toContain('AND cc.embedding IS NOT NULL');
      expect(sql).toContain('AND (cc.end_line - cc.start_line + 1) >= 10');
      expect(sql).toContain('> p_threshold');
      expect(sql).toContain('LEAST');
      expect(sql).toContain('GREATEST');
      expect(sql).toContain('DELETE FROM duplication_candidates');
    }
  });
});
