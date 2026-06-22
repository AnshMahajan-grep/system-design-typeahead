// GET /metrics — performance report: cache hit rate, DB read/write counts,
// batching write-reduction ratio, and suggest latency percentiles (p50/p95/p99).
import { Router } from 'express';
import { snapshot } from '../metrics.js';

export const metricsRouter = Router();

metricsRouter.get('/metrics', (req, res) => {
  res.json(snapshot());
});
