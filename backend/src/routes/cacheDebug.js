// GET /cache/debug?prefix=<prefix>
// Shows the CONSISTENT-HASHING routing decision for a prefix: which Redis node
// owns it, the key's position on the ring, and whether it is currently cached
// (HIT) or not (MISS). This is the endpoint used to demonstrate consistent
// hashing in the viva/demo.
//
// Also supports GET /cache/debug/distribution to show how a sample of prefixes
// spreads across the nodes (evidence that the ring balances load).
import { Router } from 'express';
import { cache } from '../cache/cacheCluster.js';
import { normalizePrefix } from '../services/suggestionService.js';

export const cacheDebugRouter = Router();

cacheDebugRouter.get('/cache/debug', async (req, res) => {
  const prefix = normalizePrefix(req.query.prefix ?? '');
  if (!prefix) return res.status(400).json({ error: 'prefix_required' });
  const info = await cache.debug(prefix);
  res.json(info);
});

cacheDebugRouter.get('/cache/debug/distribution', (req, res) => {
  // Generate a spread of sample prefixes and show how many land on each node.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const samples = [];
  for (const a of alphabet)
    for (const b of alphabet) samples.push(a + b); // 676 two-letter prefixes
  const distribution = cache.distributionSample(samples);
  res.json({ sampleSize: samples.length, distribution });
});
