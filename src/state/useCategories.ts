import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import type { Category, CategoryGroup } from '../types.ts';

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<CategoryGroup[]>([]);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const r = await api('/categories');
      setCategories(r.categories);
      setGroups(r.groups);
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { categories, groups, error, reload };
}
