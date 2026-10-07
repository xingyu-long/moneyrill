import Decimal from 'decimal.js';
export function netWorth(
  accounts: { kind: string; balance: string | null; included: boolean; currency: string }[],
) {
  let assets = new Decimal(0),
    liabilities = new Decimal(0),
    missing = 0;
  for (const a of accounts) {
    if (!a.included) continue;
    if (a.balance === null || a.currency !== 'USD') {
      missing++;
      continue;
    }
    if (a.kind === 'credit' || a.kind === 'loan') liabilities = liabilities.plus(a.balance);
    else assets = assets.plus(a.balance);
  }
  return {
    assets: assets.toFixed(2),
    liabilities: liabilities.toFixed(2),
    netWorth: assets.minus(liabilities).toFixed(2),
    missing,
  };
}
export function change(current: number | null, previous: number | null) {
  return previous === null || current === null
    ? null
    : { amount: current - previous, percent: previous > 0 ? (current / previous - 1) * 100 : null };
}
export function periodStart(end: string, range: string) {
  const d = new Date(end + 'T12:00:00Z');
  if (range === 'ALL') return '1900-01-01';
  if (range === 'YTD') return `${d.getUTCFullYear()}-01-01`;
  const months =
    ({ '1M': 1, '2M': 2, '3M': 3, '6M': 6, '1Y': 12 } as Record<string, number>)[range] || 1;
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
