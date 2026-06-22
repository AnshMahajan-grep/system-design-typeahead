// =============================================================================
// cacheCluster.js — the distributed cache layer
// =============================================================================
// Wraps the THREE Redis nodes behind a single get/set/del interface. Internally
// it uses the ConsistentHashRing to decide WHICH node owns a given key, then
// talks only to that node. The rest of the app never thinks about which Redis
// holds what — it just calls cache.get(prefix).
// =============================================================================

import Redis from 'ioredis';
import { ConsistentHashRing } from './consistentHash.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { metrics } from '../metrics.js';

export class CacheCluster {
  constructor(nodes = config.redisNodes) {
    // Open one ioredis client per physical node, keyed by "host:port".
    this.clients = new Map();
    const nodeIds = [];
    for (const { host, port } of nodes) {
      const id = `${host}:${port}`;
      nodeIds.push(id);
      const client = new Redis({ host, port, lazyConnect: false, maxRetriesPerRequest: 2 });
      // Without an 'error' listener, ioredis connection errors are thrown as
      // unhandled exceptions and crash the process. We log and swallow so a
      // single flaky cache node degrades to DB fallback instead of taking the
      // whole API down.
      client.on('error', (err) => logger.warn('Redis client error', { node: id, err: err.message }));
      this.clients.set(id, client);
    }
    // Build the consistent-hashing ring over those node ids.
    this.ring = new ConsistentHashRing(nodeIds);
    logger.info('Cache cluster initialized', { nodes: nodeIds });
  }

  // Resolve key -> owning Redis client (via the ring).
  clientFor(key) {
    const nodeId = this.ring.getNode(key);
    return { nodeId, client: this.clients.get(nodeId) };
  }

  // Suggestion cache keys are namespaced by prefix, e.g. "suggest:iph".
  // We hash the WHOLE key on the ring, so all reads/writes for a given prefix
  // deterministically land on the same node.
  static suggestKey(prefix) {
    return `suggest:${prefix}`;
  }

  // Read a JSON value. Returns parsed object or null on miss. Updates the
  // cache hit/miss metrics so we can report hit rate.
  async getSuggestions(prefix) {
    const key = CacheCluster.suggestKey(prefix);
    const { nodeId, client } = this.clientFor(key);
    try {
      const raw = await client.get(key);
      if (raw == null) {
        metrics.cacheMisses++;
        return { hit: false, nodeId, data: null };
      }
      metrics.cacheHits++;
      return { hit: true, nodeId, data: JSON.parse(raw) };
    } catch (err) {
      // If a cache node is down, treat it as a miss and fall back to Postgres.
      logger.warn('Cache GET failed, treating as miss', { nodeId, err: err.message });
      metrics.cacheMisses++;
      return { hit: false, nodeId, data: null };
    }
  }

  // Write a JSON value with a TTL (expiry) so stale suggestions can't live
  // forever. `EX` sets the key's time-to-live in seconds.
  async setSuggestions(prefix, data, ttlSeconds = config.cacheTtlSeconds) {
    const key = CacheCluster.suggestKey(prefix);
    const { nodeId, client } = this.clientFor(key);
    try {
      await client.set(key, JSON.stringify(data), 'EX', ttlSeconds);
    } catch (err) {
      logger.warn('Cache SET failed', { nodeId, err: err.message });
    }
  }

  // Explicit invalidation — used when a write changes rankings and we don't
  // want to wait for the TTL to expire.
  async invalidate(prefix) {
    const key = CacheCluster.suggestKey(prefix);
    const { client } = this.clientFor(key);
    try {
      await client.del(key);
    } catch (err) {
      /* best-effort */
    }
  }

  // For /cache/debug: which node owns this prefix, and is it currently cached?
  async debug(prefix) {
    const key = CacheCluster.suggestKey(prefix);
    const desc = this.ring.describe(key);
    const { client } = this.clientFor(key);
    let cached = false;
    let ttl = -2;
    try {
      ttl = await client.ttl(key); // -2 = no key, -1 = no expiry, >=0 = seconds left
      cached = ttl !== -2;
    } catch (err) {
      /* node may be down */
    }
    return { ...desc, cacheKey: key, status: cached ? 'HIT (cached)' : 'MISS (not cached)', ttlSeconds: ttl };
  }

  // Show how keys distribute across nodes — handy evidence for the report.
  distributionSample(sampleKeys) {
    const counts = Object.fromEntries(this.ring.nodeIds.map((id) => [id, 0]));
    for (const k of sampleKeys) {
      const node = this.ring.getNode(CacheCluster.suggestKey(k));
      counts[node]++;
    }
    return counts;
  }

  // A generic Redis client getter for the trending sorted-set (we pin trending
  // to a single, deterministic node by hashing a fixed key).
  trendingClient() {
    return this.clientFor('trending:zset');
  }
}

// Single shared instance for the whole process.
export const cache = new CacheCluster();
