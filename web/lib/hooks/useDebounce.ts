import { useEffect, useState } from 'react';

// Generic value debounce: returns `value` only after it has stayed unchanged for `ms`.
// Used by the /matches country search so filtering doesn't run on every keystroke.
export function useDebounce<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
