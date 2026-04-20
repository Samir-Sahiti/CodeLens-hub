/**
 * Benchmark vector search — US-041
 *
 * Measures latency and recall@8 of match_code_chunks against a repo
 * with at least 10k chunks to validate HNSW index performance.
 *
 * Usage:
 *   REPO_ID=<uuid> node backend/scripts/benchmark-vector-search.js
 *
 * Requirements:
 *   - SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
 *   - OPENAI_API_KEY to embed the sample queries
 *   - A repo with >= 10k indexed chunks
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const REPO_ID = process.env.REPO_ID;
const TOP_K = 8;
const RUNS = 20;  // number of query runs per sample

const SAMPLE_QUERIES = [
  'authentication middleware',
  'error handling',
  'database connection',
  'API rate limiting',
  'file upload processing',
  'user session management',
  'webhook signature verification',
  'recursive tree traversal',
  'dependency injection',
  'token refresh logic',
];

async function embedQuery(text) {
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return res.data[0].embedding;
}

async function runBenchmark() {
  if (!REPO_ID) {
    console.error('Error: Set REPO_ID=<uuid> env var to the repo you want to benchmark.');
    process.exit(1);
  }

  // Check chunk count
  const { count } = await supabase
    .from('code_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('repo_id', REPO_ID);

  console.log(`\n📊 Benchmark: HNSW Vector Search`);
  console.log(`   Repo: ${REPO_ID}`);
  console.log(`   Chunks: ${count}`);
  console.log(`   Queries: ${SAMPLE_QUERIES.length} samples × ${RUNS} runs`);
  console.log(`   TopK: ${TOP_K}\n`);

  if (count < 1000) {
    console.warn(`⚠️  Warning: Only ${count} chunks found. Results may not reflect HNSW performance at scale.`);
  }

  const latencies = [];
  const recallCounts = [];

  for (const query of SAMPLE_QUERIES) {
    const embedding = await embedQuery(query);
    const vectorLiteral = `[${embedding.join(',')}]`;

    // Brute-force baseline: plain ORDER BY with no index hint (sequential scan)
    const bruteStart = Date.now();
    const { data: brute } = await supabase
      .from('code_chunks')
      .select('file_path, start_line')
      .eq('repo_id', REPO_ID)
      .order(`embedding <=> '${vectorLiteral}'`, { ascending: true })
      .limit(TOP_K);
    const bruteTime = Date.now() - bruteStart;

    const bruteSet = new Set((brute || []).map(r => `${r.file_path}:${r.start_line}`));

    const runLatencies = [];
    let totalRecall = 0;

    for (let i = 0; i < RUNS; i++) {
      const start = Date.now();
      const { data: results } = await supabase.rpc('match_code_chunks', {
        p_repo_id: REPO_ID,
        p_embedding: vectorLiteral,
        p_top_k: TOP_K,
      });
      const elapsed = Date.now() - start;
      runLatencies.push(elapsed);

      // Recall: how many HNSW results overlap with brute-force top-K?
      const hnswSet = new Set((results || []).map(r => `${r.file_path}:${r.start_line}`));
      const overlap = [...hnswSet].filter(k => bruteSet.has(k)).length;
      totalRecall += overlap / TOP_K;
    }

    const avgLatency = runLatencies.reduce((a, b) => a + b, 0) / RUNS;
    const p95 = runLatencies.sort((a, b) => a - b)[Math.floor(RUNS * 0.95)] || avgLatency;
    const avgRecall = totalRecall / RUNS;

    latencies.push(avgLatency);
    recallCounts.push(avgRecall);

    console.log(`  Query: "${query.padEnd(40)}" | avg: ${avgLatency.toFixed(0)}ms | p95: ${p95.toFixed(0)}ms | recall@${TOP_K}: ${(avgRecall * 100).toFixed(0)}% | baseline: ${bruteTime}ms`);
  }

  const globalAvg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const globalRecall = recallCounts.reduce((a, b) => a + b, 0) / recallCounts.length;

  console.log(`\n${'─'.repeat(80)}`);
  console.log(`  Overall avg latency : ${globalAvg.toFixed(1)}ms`);
  console.log(`  Overall recall@${TOP_K}  : ${(globalRecall * 100).toFixed(1)}%`);
  console.log(`${'─'.repeat(80)}\n`);
}

runBenchmark().catch(err => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
