// =============================================================================
// searchService.js — handles a submitted search (POST /search)
// =============================================================================
// Intentionally tiny and FAST. It does NOT touch Postgres directly. It just
// normalizes the query and hands it to the batch writer, which aggregates and
// flushes asynchronously. Returns the dummy { message: "Searched" } response.
// =============================================================================

import { record } from './batchWriter.js';
import { normalizePrefix } from './suggestionService.js';

export function submitSearch(rawQuery) {
  const query = normalizePrefix(rawQuery); // reuse trim+lowercase normalization
  if (!query) {
    // Empty submission: nothing to record, but still return a valid response.
    return { message: 'Searched', recorded: false };
  }
  // Enqueue into the batch buffer (in-memory aggregation). Returns instantly.
  record(query);
  return { message: 'Searched', recorded: true, query };
}
