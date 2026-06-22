// =============================================================================
// benchmark.js — measure latency, cache hit rate, and batching write-reduction
// =============================================================================
// Run AFTER the stack is up (docker compose up) from your host:
//     cd backend && npm install && node scripts/benchmark.js
// or set BASE_URL to point elsewhere. It:
//   1. fires N /suggest requests with random prefixes (cold + warm) and reports
//      client-side latency percentiles;
//   2. fires M /search submissions to exercise the batch writer;
//   3. prints the server's /metrics so you can paste real numbers into the
//      performance report.
// Uses only Node's built-in fetch (Node 18+), no extra deps.
// =============================================================================

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const SUGGEST_REQUESTS = parseInt(process.env.SUGGEST_REQUESTS || '2000', 10);
const SEARCH_REQUESTS = parseInt(process.env.SEARCH_REQUESTS || '5000', 10);

const letters = 'abcdefghijklmnopqrstuvwxyz';
const heads = ['iph', 'sam', 'lap', 'jav', 'rea', 'doc', 'red', 'nik', 'air', 'mac', 'pos', 'sql'];

function randomPrefix() {
  // Mix of realistic head prefixes and random 2-3 letter prefixes.
  if (Math.random() < 0.6) return heads[Math.floor(Math.random() * heads.length)];
  const len = 2 + Math.floor(Math.random() * 2);
  let s = '';
  for (let i = 0; i < len; i++) s += letters[Math.floor(Math.random() * 26)];
  return s;
}

function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return Number(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(2));
}

async function runSuggestBench() {
  const latencies = [];
  for (let i = 0; i < SUGGEST_REQUESTS; i++) {
    const q = randomPrefix();
    const t0 = performance.now();
    const res = await fetch(`${BASE_URL}/suggest?q=${encodeURIComponent(q)}`);
    await res.json();
    latencies.push(performance.now() - t0);
  }
  console.log(`\n=== /suggest client-side latency over ${SUGGEST_REQUESTS} requests ===`);
  console.log({
    avgMs: Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
  });
}

async function runSearchBench() {
  // Many of these collapse onto the SAME queries -> shows batch aggregation.
  for (let i = 0; i < SEARCH_REQUESTS; i++) {
    const q = randomPrefix();
    await fetch(`${BASE_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    });
  }
  console.log(`\n=== submitted ${SEARCH_REQUESTS} searches (batched server-side) ===`);
}

async function main() {
  console.log(`Benchmarking ${BASE_URL}`);
  await runSuggestBench();
  await runSearchBench();

  // Give the batch writer a moment to flush, then read server metrics.
  await new Promise((r) => setTimeout(r, 3000));
  const metrics = await (await fetch(`${BASE_URL}/metrics`)).json();
  console.log('\n=== server /metrics ===');
  console.log(JSON.stringify(metrics, null, 2));
  console.log(
    `\nWrite reduction: ${metrics.batching.searchesReceived} searches collapsed into ` +
      `${metrics.database.writes} DB writes ` +
      `(~${metrics.batching.searchesPerDbWrite}x fewer writes).`
  );
}

main().catch((err) => {
  console.error('Benchmark failed:', err.message);
  process.exit(1);
});
