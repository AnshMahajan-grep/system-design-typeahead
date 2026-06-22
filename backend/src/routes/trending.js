// GET /trending?n=10
// Returns the current top-N trending queries (highest live recency score).
import { Router } from 'express';
import { getTrending } from '../services/trendingService.js';

export const trendingRouter = Router();

trendingRouter.get('/trending', async (req, res) => {
  try {
    const n = Math.min(parseInt(req.query.n || '10', 10), 50);
    const trending = await getTrending(n);
    res.json({ trending });
  } catch (err) {
    res.status(500).json({ error: 'trending_failed', message: err.message });
  }
});
