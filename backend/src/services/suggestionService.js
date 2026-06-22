// =============================================================================
// suggestionService.js — the core read path (must be LOW LATENCY)
// =============================================================================
// FLOW for GET /suggest?q=<prefix>:
//
//   1. Normalize the prefix (trim + lowercase) so "IPh" and "iph" share a key.
//   2. Look in the CACHE first. The cache stores a CANDIDATE POOL for the
//      prefix — the top ~50 matching queries by all-time count — on the Redis
//      node that the consistent-hash ring assigns to this prefix.
//   3. On a cache MISS, run ONE indexed prefix scan in Postgres
//      (WHERE query LIKE 'prefix%' ORDER BY count DESC LIMIT 50) and store the
//      pool in the cache with a TTL.
//   4. RANK and return the top 10:
//        - basic mode    -> pool is already sorted by count, just slice 10.
//        - recency mode  -> fetch each candidate's live recency score from
//          Redis and re-sort by blendedScore(count, recency). This recency
//          blend happens AFTER the cache, so it stays fresh without ever
//          invalidating the cached pool.
//
// WHY CACHE A POOL OF 50 INSTEAD OF EXACTLY 10?
//   So recency can promote a query that is, say, the 20th most popular for a
//   prefix but spiking right now, into the visible top 10 — without a DB hit.
// =============================================================================

import { query as dbQuery } from '../db/pool.js';
import { cache } from '../cache/cacheCluster.js';
import { config } from '../config.js';
import { metrics } from '../metrics.js';
import { getRecentScores, blendedScore } from './trendingService.js';

const CANDIDATE_POOL = 50;

// Normalize user input into a stable cache/lookup key.
export function normalizePrefix(raw) {
  return (raw || '').trim().toLowerCase();
}

// Fetch (or compute) the candidate pool for a prefix. Returns
// { pool: [{query,count}], source: 'cache'|'db', nodeId }.
async function getCandidatePool(prefix) {
  // --- 1. cache lookup (routed via consistent hashing) ---
  const { hit, nodeId, data } = await cache.getSuggestions(prefix);
  if (hit) return { pool: data, source: 'cache', nodeId };

  // --- 2. cache miss -> Postgres prefix scan ---
  // `query LIKE $1` with $1 = 'prefix%' uses the text_pattern_ops index.
  const res = await dbQuery(
    `SELECT query, count
       FROM queries
      WHERE query LIKE $1
      ORDER BY count DESC
      LIMIT $2`,
    [`${prefix}%`, CANDIDATE_POOL],
    'read'
  );
  const pool = res.rows.map((r) => ({ query: r.query, count: Number(r.count) }));

  // --- 3. populate cache for next time (fire and forget is fine, but we await
  // so the very next request in a burst also hits) ---
  await cache.setSuggestions(prefix, pool);
  return { pool, source: 'db', nodeId };
}

/**
 * Main entry. mode = 'basic' | 'recency'.
 * Returns { suggestions, meta } where meta includes cache source + node for
 * observability / the debug UI.
 */
export async function getSuggestions(rawPrefix, mode = 'recency') {
  const startedAt = performance.now();
  const prefix = normalizePrefix(rawPrefix);

  // Graceful handling of empty/missing input — no DB or cache work needed.
  if (prefix.length === 0) {
    metrics.recordSuggestLatency(performance.now() - startedAt);
    return { suggestions: [], meta: { prefix, mode, source: 'empty', nodeId: null } };
  }

  const { pool, source, nodeId } = await getCandidatePool(prefix);

  let suggestions;
  if (mode === 'basic') {
    // Pure all-time popularity ordering.
    suggestions = pool
      .slice(0, config.suggestLimit)
      .map((c) => ({ query: c.query, count: c.count }));
  } else {
    // Recency-aware: blend durable popularity with live recency heat.
    const scores = await getRecentScores(pool.map((c) => c.query));
    suggestions = pool
      .map((c) => {
        const recentScore = scores[c.query] || 0;
        return {
          query: c.query,
          count: c.count,
          recentScore: Number(recentScore.toFixed(3)),
          score: Number(blendedScore(c.count, recentScore).toFixed(4)),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, config.suggestLimit);
  }

  // Record latency for the p95 report.
  metrics.recordSuggestLatency(performance.now() - startedAt);

  return { suggestions, meta: { prefix, mode, source, nodeId } };
}
