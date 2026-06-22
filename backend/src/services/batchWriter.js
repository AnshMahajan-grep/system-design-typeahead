// =============================================================================
// batchWriter.js — collect searches, aggregate, flush in bulk
// =============================================================================
// GOAL: never hit Postgres synchronously on the hot POST /search path.
//
// HOW IT WORKS
//   - POST /search calls record(query). That just bumps an in-memory counter
//     in a Map<query, pendingCount> and returns instantly. No DB I/O.
//   - Repeated queries are AGGREGATED in the Map: 50 searches for "iphone"
//     between flushes become a single "+50" entry.
//   - We flush when EITHER:
//        * BATCH_FLUSH_MS elapses (time trigger), OR
//        * the Map reaches BATCH_MAX_SIZE distinct queries (size trigger).
//   - A flush writes ALL pending queries to Postgres in ONE upsert statement
//     (multi-row INSERT ... ON CONFLICT DO UPDATE). So N searches across M
//     distinct queries cost 1 DB write instead of N.
//
// WRITE REDUCTION EVIDENCE
//   metrics.searchesReceived counts every incoming search; metrics.dbWrites
//   counts actual upsert statements. searchesReceived / dbWrites = how many
//   searches we collapsed per write (reported by GET /metrics).
//
// FAILURE TRADE-OFF (must be able to explain this)
//   The buffer lives in process memory. If the backend crashes BEFORE a flush,
//   the searches accumulated since the last flush are LOST — counts undercount
//   slightly. We accept this because:
//     * search counts are statistical/approximate, not financial — a few lost
//       increments don't change rankings meaningfully;
//     * the flush interval is short (2s), bounding worst-case loss;
//     * we flush on graceful shutdown (SIGTERM/SIGINT) to avoid loss on normal
//       restarts.
//   If we needed durability we would back the buffer with an append-only log
//   or a Redis list / stream (write-ahead) and replay it on restart — at the
//   cost of an extra write per search. That trade is documented in the README.
// =============================================================================

import { query as dbQuery } from '../db/pool.js';
import { cache } from '../cache/cacheCluster.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { metrics } from '../metrics.js';
import { bumpRecency } from './trendingService.js';

// Map<normalizedQuery, pendingCount>
const buffer = new Map();
let flushing = false;
let timer = null;

// Accept a search into the buffer. Fast, synchronous, no DB.
export function record(query) {
  metrics.searchesReceived++;
  buffer.set(query, (buffer.get(query) || 0) + 1);

  // RECENCY is updated live (fire-and-forget) so trending reacts immediately,
  // while POPULARITY (the durable count) is deferred to the batch flush.
  bumpRecency(query, 1);

  // Size trigger: flush early if the buffer is getting large.
  if (buffer.size >= config.batchMaxSize) flush('size');
}

// Write everything currently buffered to Postgres in a single statement.
export async function flush(reason = 'timer') {
  if (flushing || buffer.size === 0) return;
  flushing = true;

  // Snapshot + clear so new searches accumulate into a fresh buffer while we
  // write the old one.
  const entries = [...buffer.entries()];
  buffer.clear();

  try {
    // Build a parameterized multi-row VALUES list:
    //   INSERT INTO queries (query,count) VALUES ($1,$2),($3,$4),...
    //   ON CONFLICT (query) DO UPDATE SET count = queries.count + EXCLUDED.count
    const values = [];
    const params = [];
    entries.forEach(([q, c], i) => {
      values.push(`($${i * 2 + 1}, $${i * 2 + 2}, now())`);
      params.push(q, c);
    });

    const sql = `
      INSERT INTO queries (query, count, last_searched)
      VALUES ${values.join(', ')}
      ON CONFLICT (query) DO UPDATE
        SET count = queries.count + EXCLUDED.count,
            last_searched = now()
    `;

    await dbQuery(sql, params, 'write'); // counts as exactly ONE db write
    metrics.batchFlushes++;

    logger.info('Batch flushed', {
      reason,
      distinctQueries: entries.length,
      totalSearches: entries.reduce((a, [, c]) => a + c, 0),
    });

    // Invalidate cached suggestion lists that these queries could appear in,
    // so the new counts show up before the TTL would expire. We invalidate
    // every prefix of each changed query (queries are short, so this is cheap).
    await invalidatePrefixes(entries.map(([q]) => q));
  } catch (err) {
    // On failure, push the entries back so we retry on the next flush instead
    // of losing them.
    for (const [q, c] of entries) buffer.set(q, (buffer.get(q) || 0) + c);
    logger.error('Batch flush failed, re-queued entries', { err: err.message });
  } finally {
    flushing = false;
  }
}

// Delete the cache keys for every prefix of every changed query.
async function invalidatePrefixes(queries) {
  const prefixes = new Set();
  for (const q of queries) {
    for (let i = 1; i <= q.length; i++) prefixes.add(q.slice(0, i));
  }
  await Promise.all([...prefixes].map((p) => cache.invalidate(p)));
}

// Start the periodic flush timer. Returns a stop function.
export function startBatchWriter() {
  timer = setInterval(() => flush('timer'), config.batchFlushMs);
  timer.unref(); // don't keep the process alive just for this timer
  logger.info('Batch writer started', {
    flushMs: config.batchFlushMs,
    maxSize: config.batchMaxSize,
  });
}

// Flush remaining buffer on graceful shutdown so a normal restart loses nothing.
export async function drainAndStop() {
  if (timer) clearInterval(timer);
  await flush('shutdown');
}
