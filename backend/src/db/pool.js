// =============================================================================
// pool.js — Postgres connection pool + schema bootstrap
// =============================================================================
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { metrics } from '../metrics.js';

const { Pool } = pg;

// A pool reuses a small set of TCP connections across many requests instead of
// opening one per query. Essential for low latency under concurrent load.
export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

const __dirname = dirname(fileURLToPath(import.meta.url));

// Run schema.sql once on startup. CREATE TABLE/INDEX IF NOT EXISTS makes this
// safe to run on every boot.
export async function initSchema() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  logger.info('Postgres schema ready');
}

// Thin wrapper so EVERY database read/write is counted for the metrics report
// (assignment asks us to report DB read/write counts).
export async function query(text, params, kind = 'read') {
  if (kind === 'read') metrics.dbReads++;
  else metrics.dbWrites++;
  return pool.query(text, params);
}

// Wait for Postgres to accept connections (compose healthcheck already helps,
// but this makes local-dev startup robust too).
export async function waitForDb(retries = 30, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      logger.warn(`Postgres not ready, retrying (${i + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('Postgres did not become ready in time');
}
