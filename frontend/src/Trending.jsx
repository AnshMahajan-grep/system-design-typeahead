import { useEffect, useState } from 'react';
import { fetchTrending } from './api.js';

// Trending section: polls /trending every few seconds so it reflects live
// search activity (recency scores decay server-side over time).
export default function Trending({ onPick }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { trending } = await fetchTrending(10);
        if (alive) { setItems(trending); setError(null); }
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    load();
    const id = setInterval(load, 4000); // refresh periodically
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <aside className="trending">
      <h3>🔥 Trending now</h3>
      {error && <div className="error">Couldn't load trending: {error}</div>}
      {items.length === 0 && !error && <div className="muted">No activity yet — try searching!</div>}
      <ol>
        {items.map((t) => (
          <li key={t.query}>
            <button className="link" onClick={() => onPick(t.query)}>{t.query}</button>
            <span className="score">{t.recentScore}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
