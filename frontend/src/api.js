// Thin API client. All calls go to /api/* which the Vite dev server proxies to
// the backend. Keeping fetch logic here keeps components clean.

export async function fetchSuggestions(prefix, mode, signal) {
  const url = `/api/suggest?q=${encodeURIComponent(prefix)}&mode=${mode}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`suggest failed: ${res.status}`);
  return res.json(); // { suggestions, meta }
}

export async function submitSearch(query) {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return res.json(); // { message: "Searched", ... }
}

export async function fetchTrending(n = 10) {
  const res = await fetch(`/api/trending?n=${n}`);
  if (!res.ok) throw new Error(`trending failed: ${res.status}`);
  return res.json(); // { trending: [{query, recentScore}] }
}
