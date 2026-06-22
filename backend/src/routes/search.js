// POST /search   body: { "query": "iphone" }
// Dummy search endpoint. Records the query (via the batch writer) and returns
// the required { message: "Searched" } response.
import { Router } from 'express';
import { submitSearch } from '../services/searchService.js';

export const searchRouter = Router();

searchRouter.post('/search', (req, res) => {
  const q = req.body?.query ?? req.body?.q ?? '';
  const result = submitSearch(q);
  // The assignment requires the response to contain { "message": "Searched" }.
  res.json(result);
});
