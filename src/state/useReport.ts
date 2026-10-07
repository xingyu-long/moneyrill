import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';

/**
 * A report from the server for the current filters. `refreshKey` reloads it (after a sync or an edit); an answer
 * to an older request never replaces a newer one.
 */
export function useReport<T>(
  path: string,
  params: Record<string, string | undefined>,
  refreshKey: unknown,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latest = useRef(0);
  const query = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => !!e[1]),
  ).toString();
  const url = `/reports/${path}?${query}`;
  useEffect(() => {
    const id = ++latest.current;
    setLoading(true);
    api(url)
      .then((r) => {
        if (id !== latest.current) return;
        setData(r as T);
        setError('');
      })
      .catch((e: any) => {
        if (id === latest.current) setError(e.message);
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
  }, [url, refreshKey]);
  return { data, loading, error };
}
