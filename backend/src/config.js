// =============================================================================
// config.js
// Central place that reads environment variables and exposes a typed config
// object. Everything else imports from here so there are no scattered
// process.env reads.
// =============================================================================

export const config = {
  port: parseInt(process.env.PORT || '8080', 10),

  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://typeahead:typeahead@localhost:5432/typeahead',

  // "host:port,host:port,..." -> [{host, port}, ...]
  // This list defines the members of the consistent-hashing ring.
  redisNodes: (process.env.REDIS_NODES || 'localhost:6390,localhost:6391,localhost:6392')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, port] = entry.split(':');
      return { host, port: parseInt(port || '6379', 10) };
    }),

  // How long a cached suggestion list lives before it must be recomputed.
  // Short TTL = fresher results; long TTL = fewer DB reads. 60s is a balance.
  cacheTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS || '60', 10),

  // Batch writer: flush every N ms OR when the buffer hits this many distinct
  // queries — whichever comes first.
  batchFlushMs: parseInt(process.env.BATCH_FLUSH_MS || '2000', 10),
  batchMaxSize: parseInt(process.env.BATCH_MAX_SIZE || '200', 10),

  // Max suggestions returned by /suggest.
  suggestLimit: parseInt(process.env.SUGGEST_LIMIT || '10', 10),

  // Trending / recency-aware ranking knobs (see trendingService.js).
  recencyWeight: parseFloat(process.env.RECENCY_WEIGHT || '1.0'),
  popularityWeight: parseFloat(process.env.POPULARITY_WEIGHT || '1.0'),
  trendingDecay: parseFloat(process.env.TRENDING_DECAY || '0.95'),
  trendingDecayMs: parseInt(process.env.TRENDING_DECAY_MS || '60000', 10),
};
