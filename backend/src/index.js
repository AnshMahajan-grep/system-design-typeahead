// =============================================================================
// index.js — Express app entry point. Wires everything together.
// =============================================================================
import express from 'express';
import cors from 'cors';

import { config } from './config.js';
import { logger } from './logger.js';
import { initSchema, waitForDb } from './db/pool.js';
import { startBatchWriter, drainAndStop } from './services/batchWriter.js';
import { startTrendingDecay } from './services/trendingService.js';

import { suggestRouter } from './routes/suggest.js';
import { searchRouter } from './routes/search.js';
import { trendingRouter } from './routes/trending.js';
import { cacheDebugRouter } from './routes/cacheDebug.js';
import { metricsRouter } from './routes/metrics.js';

async function main() {
  // Make sure the DB is reachable and the schema exists before serving traffic.
  await waitForDb();
  await initSchema();

  // Start background workers:
  //  - batch writer: periodically flushes buffered search counts to Postgres.
  //  - trending decay: periodically fades recency scores so old spikes drop off.
  startBatchWriter();
  startTrendingDecay();

  const app = express();
  app.use(cors()); // allow the React dev server / any origin to call the API
  app.use(express.json());

  // Health check.
  app.get('/health', (req, res) => res.json({ ok: true }));

  // Mount all API routes.
  app.use(suggestRouter);
  app.use(searchRouter);
  app.use(trendingRouter);
  app.use(cacheDebugRouter);
  app.use(metricsRouter);

  const server = app.listen(config.port, () => {
    logger.info(`Typeahead backend listening on :${config.port}`);
  });

  // Graceful shutdown: flush the batch buffer so a normal restart loses no
  // counts (see the failure trade-off discussion in batchWriter.js).
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
      logger.info(`${sig} received, draining batch buffer...`);
      await drainAndStop();
      server.close(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  logger.error('Fatal startup error', { err: err.message });
  process.exit(1);
});
