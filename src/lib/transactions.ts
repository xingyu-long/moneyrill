import type { Category, Transaction } from '../types.ts';

export const merchantOf = (t: Transaction) => t.merchant_name || t.name;

/** Brokerage activity, or anything on an investment account (what the Transactions page hides by default). */
export const isInvestmentRow = (t: Pick<Transaction, 'activity' | 'account_kind'>) =>
  t.activity === 'investment' || t.account_kind === 'investment';

/** What a row says instead of a category when it is brokerage activity without one. */
export const activityLabel = (t: Transaction) =>
  t.investment
    ? investmentLabel({ ...t.investment, symbol: t.investment.security?.symbol ?? null })
    : '';

/** Newest first, the order the server returns them in. */
export function sortTransactions(list: Transaction[]) {
  return [...list].sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1,
  );
}

/** Rows grouped by their (effective) date, with the day's net cash flow (money in minus money out). */
export function groupByDate(list: Transaction[], { skipInvestments = false } = {}) {
  const groups: { date: string; rows: Transaction[]; net: number }[] = [];
  for (const t of sortTransactions(list)) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== t.date) {
      g = { date: t.date, rows: [], net: 0 };
      groups.push(g);
    }
    g.rows.push(t);
    // On the Transactions page the day's total stays the same whether investment accounts are shown or not.
    if (!(skipInvestments && isInvestmentRow(t))) g.net -= Number(t.amount);
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

/** The label of a brokerage row: "Buy · 10 VOO @ $500.00", "Dividend", "Shares in". */
export function investmentLabel(r: {
  type: string;
  subtype: string | null;
  quantity: string;
  price: string | null;
  symbol: string | null;
}) {
  const q = Math.abs(Number(r.quantity));
  const what = r.symbol ? ` ${r.symbol}` : '';
  const at = r.price !== null && Number(r.price) > 0 ? ` @ $${Number(r.price).toFixed(2)}` : '';
  const name = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
  if (r.type === 'buy' || r.type === 'sell')
    return `${name(r.type)}${q ? ` · ${q}${what}${at}` : ''}`;
  if (r.type === 'transfer' && Number(r.quantity) !== 0)
    return Number(r.quantity) > 0 ? 'Shares in' : 'Shares out';
  if (r.type === 'cancel') return 'Cancelled';
  if (r.type === 'cash' || r.type === 'fee' || r.type === 'transfer')
    return name(r.subtype && r.subtype !== r.type ? r.subtype : r.type);
  return name(r.type);
}
