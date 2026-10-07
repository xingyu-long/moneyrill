import type { Category, Transaction } from '../types.ts';

export const merchantOf = (t: Transaction) => t.merchant_name || t.name;

/** Newest first, the order the server returns them in. */
export function sortTransactions(list: Transaction[]) {
  return [...list].sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1,
  );
}

/** Rows grouped by their (effective) date, with the day's net cash flow (money in minus money out). */
export function groupByDate(list: Transaction[]) {
  const groups: { date: string; rows: Transaction[]; net: number }[] = [];
  for (const t of sortTransactions(list)) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== t.date) {
      g = { date: t.date, rows: [], net: 0 };
      groups.push(g);
    }
    g.rows.push(t);
    g.net -= Number(t.amount);
  }
  return groups;
}

/** Categories by group, in the order the settings list them. */
export function groupCategories(list: Category[]) {
  const groups = new Map<string, Category[]>();
  for (const c of list) groups.set(c.group_name, [...(groups.get(c.group_name) ?? []), c]);
  return [...groups].map(([group, categories]) => ({ group, categories }));
}

export const longDate = (v: string) =>
  new Date(v + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
