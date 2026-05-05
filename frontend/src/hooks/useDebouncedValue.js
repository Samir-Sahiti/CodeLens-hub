import { useState, useEffect } from 'react';

/**
 * useDebouncedValue — returns a debounced copy of `value` that only updates
 * after `delay` ms of inactivity. Eliminates per-keystroke recomputations in
 * filter/search inputs that drive expensive useMemo chains.
 *
 * Usage:
 *   const debouncedSearch = useDebouncedValue(searchQuery, 200);
 *   // use debouncedSearch in useMemo instead of searchQuery
 */
export function useDebouncedValue(value, delay = 200) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
