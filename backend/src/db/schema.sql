-- =============================================================================
-- schema.sql  — the primary (durable) data store
-- =============================================================================
-- One row per unique search query.
--
--   query          the search text (PRIMARY KEY; stored lowercase/normalized)
--   count          all-time number of times this query has been searched
--   last_searched  timestamp of the most recent search (used by trending)
--
-- This single table is the source of truth. The Redis cache and the in-memory
-- batch buffer are both derived from / feed into it.
CREATE TABLE IF NOT EXISTS queries (
  query          TEXT PRIMARY KEY,
  count          BIGINT      NOT NULL DEFAULT 0,
  last_searched  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- THE key to fast prefix search.
--
-- We look up suggestions with:   WHERE query LIKE 'iph%'
-- A normal B-tree index can't accelerate LIKE because it orders by the DB's
-- collation. `text_pattern_ops` builds the index ordered by raw byte/character
-- comparison, which is EXACTLY what a left-anchored `LIKE 'prefix%'` needs.
-- With this index a prefix scan is an index range scan (fast), not a full
-- table scan over 100k+ rows.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_queries_query_pattern
  ON queries (query text_pattern_ops);

-- Secondary index to fetch the globally most popular queries quickly
-- (used to warm trending and as a fallback).
CREATE INDEX IF NOT EXISTS idx_queries_count
  ON queries (count DESC);
