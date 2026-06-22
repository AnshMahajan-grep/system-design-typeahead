// GET /suggest?q=<prefix>&mode=<basic|recency>
// Returns up to 10 prefix-matching suggestions.
//   - basic  : sorted purely by all-time count
//   - recency: sorted by blended popularity + recency (default)
import { Router } from 'express';
import { getSuggestions } from '../services/suggestionService.js';

export const suggestRouter = Router();

suggestRouter.get('/suggest', async (req, res) => {
  try {
    // `q` may be missing or empty — getSuggestions handles that gracefully.
    const q = req.query.q ?? '';
    const mode = req.query.mode === 'basic' ? 'basic' : 'recency';
    const { suggestions, meta } = await getSuggestions(q, mode);
    res.json({ suggestions, meta });
  } catch (err) {
    res.status(500).json({ error: 'suggest_failed', message: err.message });
  }
});
