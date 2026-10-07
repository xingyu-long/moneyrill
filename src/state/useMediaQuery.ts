import { useEffect, useState } from 'react';

/** Whether a CSS media query matches now, and again whenever it changes. False where the browser cannot say. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, [query]);
  return matches;
}
