import { useEffect, useRef, useState } from 'react';
import { fetchSuggestions, submitSearch } from './api.js';
import { useDebounce } from './useDebounce.js';
import Trending from './Trending.jsx';

export default function App() {
  const [input, setInput] = useState('');          // raw text in the box
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);          // is the dropdown showing
  const [highlight, setHighlight] = useState(-1);   // keyboard-highlighted row
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('recency');      // 'basic' | 'recency' toggle
  const [searchResult, setSearchResult] = useState(null); // dummy API response
  const [meta, setMeta] = useState(null);           // cache source/node info

  // Debounce the input so we hit the backend only after the user pauses typing.
  const debounced = useDebounce(input, 150);

  // Fetch suggestions whenever the debounced prefix (or mode) changes.
  useEffect(() => {
    const prefix = debounced.trim();
    if (!prefix) { setSuggestions([]); setMeta(null); setOpen(false); return; }

    // AbortController cancels an in-flight request if a newer keystroke arrives,
    // preventing out-of-order responses from overwriting newer results.
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchSuggestions(prefix, mode, controller.signal)
      .then(({ suggestions, meta }) => {
        setSuggestions(suggestions);
        setMeta(meta);
        setOpen(true);
        setHighlight(-1);
      })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [debounced, mode]);

  // Submit a search: call the dummy /search API, show its response, and close
  // the dropdown. The backend records the query (batched) and bumps recency.
  async function doSearch(q) {
    const query = (q ?? input).trim();
    if (!query) return;
    setInput(query);
    setOpen(false);
    try {
      const result = await submitSearch(query);
      setSearchResult({ ...result, at: new Date().toLocaleTimeString() });
    } catch (e) {
      setError(e.message);
    }
  }

  // Keyboard navigation in the dropdown: Up/Down to move, Enter to pick/submit,
  // Escape to close.
  function onKeyDown(e) {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Enter') doSearch();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // If a suggestion is highlighted, search that; otherwise search the input.
      if (highlight >= 0) doSearch(suggestions[highlight].query);
      else doSearch();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="page">
      <header>
        <h1>🔎 Search Typeahead</h1>
        <p className="muted">
          Express + Postgres + distributed Redis (consistent hashing) · batched writes · recency-aware ranking
        </p>
      </header>

      <div className="layout">
        <main>
          {/* Ranking mode toggle — lets you SHOW the difference between the
              basic (all-time popularity) and recency-aware rankings. */}
          <div className="mode">
            <label className={mode === 'recency' ? 'active' : ''}>
              <input type="radio" checked={mode === 'recency'} onChange={() => setMode('recency')} />
              Recency-aware
            </label>
            <label className={mode === 'basic' ? 'active' : ''}>
              <input type="radio" checked={mode === 'basic'} onChange={() => setMode('basic')} />
              Basic (popularity)
            </label>
          </div>

          <div className="searchbar">
            <div className="combo">
              <input
                className="search-input"
                type="text"
                placeholder="Type to search… e.g. iphone, java, laptop"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                onFocus={() => suggestions.length && setOpen(true)}
                autoFocus
              />
              {/* Suggestion dropdown */}
              {open && (
                <ul className="dropdown">
                  {loading && <li className="muted">Loading…</li>}
                  {!loading && suggestions.length === 0 && (
                    <li className="muted">No matches</li>
                  )}
                  {suggestions.map((s, i) => (
                    <li
                      key={s.query}
                      className={i === highlight ? 'row highlight' : 'row'}
                      onMouseEnter={() => setHighlight(i)}
                      onMouseDown={(e) => { e.preventDefault(); doSearch(s.query); }}
                    >
                      <span className="q">{s.query}</span>
                      <span className="count">
                        {s.count.toLocaleString()}
                        {mode === 'recency' && s.recentScore > 0 && (
                          <em className="hot"> · 🔥{s.recentScore}</em>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button className="go" onClick={() => doSearch()}>Search</button>
          </div>

          {error && <div className="error">Error: {error}</div>}

          {/* Cache routing info for the current prefix (nice for the demo). */}
          {meta && meta.source && (
            <div className="meta">
              served from <b>{meta.source}</b>
              {meta.nodeId && <> · cache node <b>{meta.nodeId}</b></>}
              {' '}· mode <b>{meta.mode}</b>
            </div>
          )}

          {/* The dummy /search API response. */}
          {searchResult && (
            <div className="result">
              <div className="badge">{searchResult.message}</div>
              <div className="muted">
                query: <b>{searchResult.query || '(empty)'}</b> · at {searchResult.at}
              </div>
            </div>
          )}
        </main>

        <Trending onPick={(q) => doSearch(q)} />
      </div>
    </div>
  );
}
