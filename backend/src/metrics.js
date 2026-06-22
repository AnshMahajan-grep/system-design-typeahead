// =============================================================================
// metrics.js — in-process counters for the performance report
// -----------------------------------------------------------------------------
// The assignment asks us to report: p95 latency, cache hit rate, and DB
// read/write counts (and evidence that batching reduces writes). We collect
// all of that here and expose it via GET /metrics.
// =============================================================================

// Latency samples for /suggest, kept in a fixed-size ring buffer so memory is
// bounded even after millions of requests.
const MAX_SAMPLES = 5000;

export const metrics = {
  cacheHits: 0,
  cacheMisses: 0,

  dbReads: 0,
  dbWrites: 0, // counts actual UPSERT statements issued to Postgres

  searchesReceived: 0, // POST /search calls accepted into the batch buffer
  batchFlushes: 0, // number of times the buffer was flushed to Postgres

  suggestLatencies: [], // ms samples (ring buffer)

  recordSuggestLatency(ms) {
    this.suggestLatencies.push(ms);
    if (this.suggestLatencies.length > MAX_SAMPLES) this.suggestLatencies.shift();
  },
};

// percentile(95) over the collected latency samples.
function percentile(samples, p) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[idx].toFixed(2));
}

export function snapshot() {
  const totalCacheLookups = metrics.cacheHits + metrics.cacheMisses;
  const lat = metrics.suggestLatencies;
  const avg = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0;

  return {
    cache: {
      hits: metrics.cacheHits,
      misses: metrics.cacheMisses,
      hitRate:
        totalCacheLookups === 0
          ? 0
          : Number((metrics.cacheHits / totalCacheLookups).toFixed(4)),
    },
    database: {
      reads: metrics.dbReads,
      writes: metrics.dbWrites,
    },
    batching: {
      searchesReceived: metrics.searchesReceived,
      batchFlushes: metrics.batchFlushes,
      // The headline number: how many individual searches we collapsed per
      // actual DB write. Higher = batching is doing more work.
      searchesPerDbWrite:
        metrics.dbWrites === 0
          ? 0
          : Number((metrics.searchesReceived / metrics.dbWrites).toFixed(2)),
    },
    suggestLatencyMs: {
      samples: lat.length,
      avg: Number(avg.toFixed(2)),
      p50: percentile(lat, 50),
      p95: percentile(lat, 95),
      p99: percentile(lat, 99),
    },
  };
}
