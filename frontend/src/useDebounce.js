import { useEffect, useState } from 'react';

// Debounce a value: only updates `debounced` after the input has stopped
// changing for `delay` ms. We use this so typing "iphone" fires ONE backend
// request after the user pauses, not six (one per keystroke) — exactly the
// "avoid unnecessary backend calls" requirement.
export function useDebounce(value, delay = 150) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id); // cancel the previous timer on each keystroke
  }, [value, delay]);
  return debounced;
}
