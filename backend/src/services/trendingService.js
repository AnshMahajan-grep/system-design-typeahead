// =============================================================================
// trendingService.js — recency-aware ranking + trending searches
// =============================================================================
// TWO signals decide ordering:
//   1. POPULARITY  — all-time `count` from Postgres (slow-moving, durable).
//   2. RECENCY     — how much a query has been searched RECENTLY. We keep this
//                    in a Redis SORTED SET ("trending:zset") whose scores DECAY
//                    over time.
//
// HOW RECENT SEARCHES ARE TRACKED
//   Every accepted search does a ZINCRBY trending:zset 1 <query>. The sorted
//   set therefore holds a "recent heat" score per query, updated in real time.
//
// HOW WE AVOID PERMANENTLY OVER-RANKING A BRIEFLY-POPULAR QUERY
//   A background job runs every TRENDING_DECAY_MS and multiplies every score by
//   TRENDING_DECAY (e.g. 0.95). A query searched in a burst and then abandoned
//   sees its recent score halve roughly every ~14 ticks and fade toward zero,
//   so it naturally drops out of trending. All-time `count` is untouched, so it
//   still ranks on popularity — it just loses the recency boost. This is an
//   exponential-decay / "exponentially weighted moving" popularity.
//
// HOW RECENCY AFFECTS THE SUGGESTION RANKING
//   finalScore = POPULARITY_WEIGHT * log10(count + 1)
//              + RECENCY_WEIGHT    * recentScore
//   We use log10(count) so a query with 1,000,000 all-time hits doesn't
//   permanently bury a query that's spiking right now; the recency term can
//   realistically overtake it. Weights are configurable via env.
// =============================================================================

import { cache } from '../cache/cacheCluster.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const TRENDING_KEY = 'trending:zset';

// Bump a query's recent-heat score. `by` lets the batch writer apply an
// aggregated bump (e.g. +5 for 5 searches) in one call.
export async function bumpRecency(query, by = 1) {
  const { client } = cache.trendingClient();
  try {
    await client.zincrby(TRENDING_KEY, by, query);
  } catch (err) {
    logger.warn('bumpRecency failed', { err: err.message });
  }
}

// Look up recent-heat scores for a batch of queries at once (pipelined) so the
// suggestion path makes a single round-trip, not one per candidate.
export async function getRecentScores(queries) {
  if (queries.length === 0) return {};
  const { client } = cache.trendingClient();
  try {
    const pipeline = client.pipeline();
    for (const q of queries) pipeline.zscore(TRENDING_KEY, q);
    const results = await pipeline.exec(); // [[err, value], ...]
    const out = {};
    queries.forEach((q, i) => {
      const val = results[i] && results[i][1];
      out[q] = val ? parseFloat(val) : 0;
    });
    return out;
  } catch (err) {
    logger.warn('getRecentScores failed', { err: err.message });
    return {};
  }
}

// Combine durable popularity with live recency into one sortable score.
export function blendedScore(count, recentScore) {
  return (
    config.popularityWeight * Math.log10(count + 1) +
    config.recencyWeight * recentScore
  );
}

// Top-N trending queries right now (highest recent-heat scores).
export async function getTrending(n = 10) {
  const { client } = cache.trendingClient();
  try {
    // ZREVRANGE ... WITHSCORES returns [member, score, member, score, ...]
    const flat = await client.zrevrange(TRENDING_KEY, 0, n - 1, 'WITHSCORES');
    const out = [];
    for (let i = 0; i < flat.length; i += 2) {
      out.push({ query: flat[i], recentScore: Number(parseFloat(flat[i + 1]).toFixed(3)) });
    }
    return out;
  } catch (err) {
    logger.warn('getTrending failed', { err: err.message });
    return [];
  }
}

// The decay tick. Reads all members, multiplies each score by the decay factor,
// and drops members that have decayed to ~0 (keeps the set small).
export async function decayTrending() {
  const { client } = cache.trendingClient();
  try {
    const flat = await client.zrange(TRENDING_KEY, 0, -1, 'WITHSCORES');
    if (flat.length === 0) return;
    const pipeline = client.pipeline();
    for (let i = 0; i < flat.length; i += 2) {
      const member = flat[i];
      const newScore = parseFloat(flat[i + 1]) * config.trendingDecay;
      if (newScore < 0.01) pipeline.zrem(TRENDING_KEY, member);
      else pipeline.zadd(TRENDING_KEY, newScore, member);
    }
    await pipeline.exec();
  } catch (err) {
    logger.warn('decayTrending failed', { err: err.message });
  }
}

// Start the periodic decay loop. Called once at startup.
export function startTrendingDecay() {
  setInterval(decayTrending, config.trendingDecayMs).unref();
  logger.info('Trending decay loop started', {
    everyMs: config.trendingDecayMs,
    factor: config.trendingDecay,
  });
}
