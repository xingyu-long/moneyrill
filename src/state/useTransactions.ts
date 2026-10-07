import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { sortTransactions } from '../lib/transactions.ts';
import type { Transaction } from '../types.ts';

export type TransactionFilters = {
  q: string;
  account: string;
  category: string;
  /** Only used by the reports: a date range, a kind and lists of categories or accounts. */
  from?: string;
  to?: string;
  type?: 'income' | 'expense';
  merchant?: string;
  categories?: number[];
  accounts?: string[];
};

function query(filters: TransactionFilters) {
  const p = new URLSearchParams({ limit: '100' });
  if (filters.q.trim()) p.set('q', filters.q.trim());
  if (filters.account) p.set('account', filters.account);
  if (filters.category) p.set('category', filters.category);
  if (filters.from) p.set('from', filters.from);
  if (filters.to) p.set('to', filters.to);
  if (filters.type) p.set('type', filters.type);
  if (filters.merchant) p.set('merchant', filters.merchant);
  if (filters.categories?.length) p.set('categories', filters.categories.join(','));
  if (filters.accounts?.length) p.set('accounts', filters.accounts.join(','));
  return '/transactions?' + p;
}

/** The list, a page at a time. `refreshKey` reloads it (for example after a sync). */
export function useTransactions(filters: TransactionFilters, refreshKey: unknown) {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const latest = useRef(0);
  // One string stands for the whole filter, so a new array with the same content does not reload.
  const key = query(filters);
  useEffect(() => {
    const id = ++latest.current;
    setLoading(true);
    // Debounce typing in the search box.
    const timer = setTimeout(async () => {
      try {
        const r = await api(key);
        if (id !== latest.current) return;
        setRows(r.transactions);
        setNext(r.nextCursor);
        setError('');
      } catch (e: any) {
        if (id === latest.current) setError(e.message);
      } finally {
        if (id === latest.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [key, refreshKey]);
  const more = useCallback(async () => {
    if (!next) return;
    try {
      const r = await api(`${key}&cursor=${encodeURIComponent(next)}`);
      setRows((old) => [...old, ...r.transactions]);
      setNext(r.nextCursor);
    } catch (e: any) {
      setError(e.message);
    }
  }, [next, key]);
  /** Replace one row with the server's copy; the list is re-sorted because the date may have moved. */
  const replace = useCallback(
    (t: Transaction) => setRows((old) => sortTransactions(old.map((o) => (o.id === t.id ? t : o)))),
    [],
  );
  /** Drop a row you deleted. */
  const remove = useCallback((id: string) => setRows((old) => old.filter((o) => o.id !== id)), []);
  return { rows, hasMore: !!next, loading, error, more, replace, remove };
}
