import type { Account, Holding, HoldingRow, Position, Price, SortState } from '../types.ts';
import { number, pct } from './format.ts';

/** Closes per ticker, oldest first. */
export function priceHistory(prices: Price[] = []) {
  const m = new Map<string, { date: string; close: number }[]>();
  for (const p of prices) {
    if (!m.has(p.symbol)) m.set(p.symbol, []);
    m.get(p.symbol)!.push({ date: p.date, close: Number(p.close) });
  }
  for (const list of m.values()) list.sort((x, y) => x.date.localeCompare(y.date));
  return m;
}

const daysBefore = (iso: string, days: number) =>
  new Date(Date.parse(iso + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);

const symbolOf = (h: { symbol: string | null }) => (h.symbol || '').trim().toUpperCase();

/**
 * Latest holdings per account, plus a placeholder row for any balance the holdings don't explain.
 * A ticker with downloaded closes is shown at the latest close in every real account (so one ticker has one
 * price), and its change runs from the first close in the range; the demo accounts keep their own prices.
 * The unexplained balance is still measured against what the bank reported, so a difference between the two
 * prices never shows up as unreported value.
 */
export function buildHoldingRows(
  accounts: Account[],
  allHoldings: Holding[],
  start: string,
  prices: Price[] = [],
): HoldingRow[] {
  const rows: HoldingRow[] = [];
  const history = priceHistory(prices);
  for (const a of accounts) {
    const all = allHoldings.filter((h) => h.account_id === a.id);
    const latest = a.holdings_as_of || all.reduce((m, h) => (h.date > m ? h.date : m), '');
    const current = all.filter((h) => h.date === latest);
    for (const h of current) {
      const closes = a.source === 'simulated' ? undefined : history.get(symbolOf(h));
      const lastClose = closes?.[closes.length - 1];
      // The same rule the server uses when it prices the balance: a close in the last week, and not more than
      // double or less than half the bank's price (a split the bank has not caught up with, a wrong symbol).
      const bank = number(h.price);
      const latestClose =
        lastClose &&
        bank !== null &&
        bank > 0 &&
        lastClose.close >= bank * 0.5 &&
        lastClose.close <= bank * 2 &&
        lastClose.date >= daysBefore(h.date, 7)
          ? lastClose
          : undefined;
      if (latestClose) {
        const first = closes!.find((c) => c.date >= start) ?? closes![0];
        const quantity = number(h.quantity);
        rows.push({
          ...h,
          accountName: a.name,
          quantity,
          price: latestClose.close,
          value: quantity === null ? number(h.value) : quantity * latestClose.close,
          cost_basis: number(h.cost_basis),
          change: first.date !== latestClose.date ? pct(latestClose.close, first.close) : null,
          priceDate: latestClose.date,
        });
        continue;
      }
      const old = all.find((x) => x.security_id === h.security_id && x.date >= start);
      rows.push({
        ...h,
        accountName: a.name,
        quantity: number(h.quantity),
        price: number(h.price),
        value: number(h.value),
        cost_basis: number(h.cost_basis),
        change:
          old && old.date !== h.date && h.price !== null
            ? pct(Number(h.price), number(old.price))
            : null,
      });
    }
    const total = current.reduce((s, h) => s + (number(h.value) || 0), 0),
      // What the bank reports, not the balance priced at market closes: measured against the bank's own values.
      remainder = (number(a.balance) || 0) - (number(a.balance_adjustment) || 0) - total;
    if (Math.abs(remainder) > 0.05 && a.balance !== null)
      rows.push({
        account_id: a.id,
        security_id: 'unreported:' + a.id,
        date: latest,
        symbol: '—',
        name: 'Unreported account value',
        asset_class: 'Unreported',
        quantity: null,
        price: null,
        value: remainder,
        cost_basis: null,
        change: null,
        accountName: a.name,
      });
  }
  return rows.sort((a, b) => (b.value || 0) - (a.value || 0));
}

export const securityKey = (h: { symbol: string; name: string }) => h.symbol || h.name;

/** Sum the same security across accounts. Unreported rows stay separate, per account. */
export function aggregatePositions(rows: HoldingRow[]): Position[] {
  const m = new Map<string, Position>();
  for (const h of rows) {
    const unreported = h.asset_class === 'Unreported';
    const key = unreported ? h.security_id : securityKey(h);
    const p = m.get(key);
    if (!p) {
      m.set(key, {
        ...h,
        security_id: key,
        account_id: key,
        accountName: unreported ? h.accountName : null,
        costKnown: h.cost_basis !== null,
      });
      continue;
    }
    p.quantity =
      p.quantity === null && h.quantity === null ? null : (p.quantity || 0) + (h.quantity || 0);
    p.value = p.value === null && h.value === null ? null : (p.value || 0) + (h.value || 0);
    p.costKnown = p.costKnown && h.cost_basis !== null;
    p.cost_basis = p.costKnown ? (p.cost_basis || 0) + (h.cost_basis || 0) : null;
    if (p.price === null) p.price = h.price;
    if (p.change === null) p.change = h.change;
  }
  return [...m.values()];
}

/** Sort by a column; rows with no value always go last. */
export function sortPositions(positions: Position[], sort: SortState): Position[] {
  const get = (h: Position): number | string | null | undefined =>
    sort.key === 'symbol'
      ? h.symbol === '—'
        ? h.name
        : h.symbol || h.name
      : sort.key === 'gain'
        ? h.cost_basis === null || h.value === null
          ? null
          : h.value - h.cost_basis
        : (h as any)[sort.key];
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...positions].sort((a, b) => {
    const x = get(a),
      y = get(b);
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * factor;
  });
}

/** Next sort state when a column header is clicked. */
export function nextSort(current: SortState, key: string): SortState {
  return current.key === key
    ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'symbol' ? 'asc' : 'desc' };
}

/** Everything the security detail panel shows. */
export function buildSecurityDetail(
  openSecurity: string | null,
  rows: HoldingRow[],
  allHoldings: Holding[],
  accountIds: Set<string>,
  start: string,
  prices: Price[] = [],
) {
  if (!openSecurity) return null;
  const mine = rows.filter(
    (h) => h.asset_class !== 'Unreported' && securityKey(h) === openSecurity,
  );
  if (!mine.length) return null;
  const byDate = new Map<string, number>();
  for (const h of allHoldings) {
    if (
      !accountIds.has(h.account_id) ||
      securityKey(h) !== openSecurity ||
      h.price === null ||
      h.date < start
    )
      continue;
    if (!byDate.has(h.date)) byDate.set(h.date, Number(h.price));
  }
  // One price history per ticker when it has been downloaded, the same one every account is valued at.
  const closes = (priceHistory(prices).get(symbolOf(mine[0])) || []).filter((c) => c.date >= start);
  const series = closes.length
    ? closes.map((c) => ({ date: c.date, price: c.close }))
    : [...byDate]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, price]) => ({ date, price }));
  const first = series[0]?.price ?? null,
    last = series.length ? series[series.length - 1].price : mine[0].price;
  const sample = mine[0];
  const quantity = mine.every((r) => r.quantity === null)
      ? null
      : mine.reduce((t, r) => t + (r.quantity || 0), 0),
    value = mine.reduce((t, r) => t + (r.value || 0), 0);
  return {
    symbol: sample.symbol,
    name: sample.name,
    price: last,
    amount: series.length > 1 && first !== null && last !== null ? last - first : null,
    change: series.length > 1 ? pct(last as number, first) : null,
    points: series.map((x) => ({
      date: x.date,
      change: first ? (x.price / first - 1) * 100 : null,
    })),
    quantity,
    value,
    accounts: [...mine].sort((a, b) => (b.value || 0) - (a.value || 0)),
  };
}

/** Totals by security, asset class or account, largest first. */
export function allocate(rows: HoldingRow[], grouping: string) {
  const m = new Map<string, number>();
  for (const h of rows) {
    const key =
      grouping === 'account'
        ? (h.accountName as string)
        : grouping === 'asset'
          ? h.asset_class
          : h.symbol === '—'
            ? h.name
            : `${h.symbol || h.name}`;
    m.set(key, (m.get(key) || 0) + (h.value || 0));
  }
  return [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}
