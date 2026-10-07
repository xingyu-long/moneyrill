import type { Benchmark } from '../types.ts';
import { pct } from './format.ts';

type Point = { date: string; value: number | null };

export type BenchmarkOption = { symbol: string; label: string; note: string; simulated: boolean };

/** Real series are fetched by the sync job; simulated ones exist only in the staging demo data. */
export const BENCHMARK_OPTIONS: BenchmarkOption[] = [
  { symbol: 'SPY', label: 'S&P 500', note: 'SPY · dividends reinvested', simulated: false },
  { symbol: 'QQQ', label: 'Nasdaq-100', note: 'QQQ · dividends reinvested', simulated: false },
  { symbol: 'US large cap', label: 'US large cap', note: 'Simulated benchmark', simulated: true },
  {
    symbol: 'US total market',
    label: 'US total market',
    note: 'Simulated benchmark',
    simulated: true,
  },
  { symbol: 'US bonds', label: 'US bonds', note: 'Simulated benchmark', simulated: true },
];

/**
 * Benchmarks that have stored data. The staging demo also offers its simulated series, after the
 * real ones, so staging exercises exactly what production shows.
 */
export function availableBenchmarks(benchmarks: Benchmark[], includeSimulated: boolean) {
  const present = new Set(benchmarks.map((b) => b.symbol));
  return BENCHMARK_OPTIONS.filter(
    (o) => present.has(o.symbol) && (includeSimulated || !o.simulated),
  );
}

/** One symbol's observations, including the last one before `from` so the start can be filled. */
export function benchmarkSeries(benchmarks: Benchmark[], symbol: string, from: string) {
  const own = benchmarks.filter((b) => b.symbol === symbol);
  const first = own.findIndex((b) => b.date >= from);
  if (first === -1) return own.slice(-1);
  return own.slice(Math.max(0, first - 1));
}

/** Each date's level: the latest close on or before it (markets close on weekends and holidays). */
function levelsOn(dates: string[], benchmarks: Benchmark[]) {
  let i = -1;
  return dates.map((date) => {
    while (i + 1 < benchmarks.length && benchmarks[i + 1].date <= date) i++;
    return i >= 0 ? Number(benchmarks[i].level) : null;
  });
}

/** Percent change of a benchmark from its first level on the dates; null before it has one. */
function rebased(dates: string[], benchmarks: Benchmark[]) {
  const levels = levelsOn(dates, benchmarks);
  const base = levels.find((l) => l !== null) ?? null;
  return levels.map((l) => (l !== null && base ? pct(l, base) : null));
}

/**
 * Portfolio value change and benchmark change, both as percent from the first point.
 * Markets close on weekends and holidays, so each date uses the latest close on or before it.
 */
export function performanceSeries(
  history: Point[],
  benchmarks: Benchmark[],
  portfolioStart: number | null,
) {
  const lines = rebased(
    history.map((row) => row.date),
    benchmarks,
  );
  return history.map((row, k) => ({
    date: row.date,
    portfolio: row.value === null ? null : pct(row.value, portfolioStart),
    benchmark: lines[k],
  }));
}

/** Money added to (positive) or taken out of (negative) the portfolio from outside, on a date. */
export type Flow = { date: string; amount: number };

type Value = { date: string; value: number | null };

export type ReturnPeriod = {
  start: string;
  end: string;
  startValue: number;
  endValue: number;
  /** Net cash flow in the period. */
  flow: number;
  /** What the market did: end value - start value - net cash flow. */
  gain: number;
  /** null when the money at risk was not positive. */
  ret: number | null;
};

export type ReturnPoint = { date: string; value: number; portfolio: number | null };

/** What set the day a return opens: the range itself, the first known balance, or the day cash flows are known from. */
export type OpeningLimit = 'range' | 'balance' | 'flows';

export type PortfolioReturn = {
  from: string;
  /** Which of the three limits decided `from` (the latest one wins). */
  limit: OpeningLimit;
  to: string;
  startValue: number;
  endValue: number;
  flow: number;
  gain: number;
  /** Chained over the months, as a fraction (0.2 is 20%). null when a month had no usable base. */
  ret: number | null;
  periods: ReturnPeriod[];
  /** One point per balance date; `portfolio` is the cumulative return in percent. */
  points: ReturnPoint[];
};

const DAY = 86400000;
const time = (date: string) => Date.parse(date + 'T12:00:00Z');
const daysBetween = (a: string, b: string) => Math.round((time(b) - time(a)) / DAY);
const addDays = (date: string, n: number) =>
  new Date(time(date) + n * DAY).toISOString().slice(0, 10);
const monthStart = (date: string) => date.slice(0, 7) + '-01';
const monthEnd = (date: string) => {
  const d = new Date(time(date));
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
};

/** The last day of every month that ends after `after` and before `before`. */
function monthEnds(after: string, before: string) {
  const out: string[] = [];
  for (let end = monthEnd(after); end < before; end = monthEnd(addDays(end, 1)))
    if (end > after) out.push(end);
  return out;
}

/** The value on the last known date on or before `date`. */
function valueOn(rows: Value[], date: string) {
  let found: number | null = null;
  for (const r of rows) {
    if (r.date > date) break;
    found = r.value;
  }
  return found;
}

/**
 * Modified Dietz return of one period (start, end]: what the market did, divided by the money at work.
 *
 *   return = (end value - start value - cash flow) / (start value + weighted cash flow)
 *
 * A flow counts for the share of the period it was in the account (a deposit on day 1 of 30 counts almost
 * fully, one on the last day hardly at all), counting a flow's own day as half a day.
 */
export function periodReturn(
  startDate: string,
  endDate: string,
  startValue: number,
  endValue: number,
  flows: Flow[],
): ReturnPeriod {
  const inside = flows.filter((f) => f.date > startDate && f.date <= endDate);
  const length = daysBetween(startDate, endDate);
  const flow = inside.reduce((s, f) => s + f.amount, 0);
  const weighted = inside.reduce(
    (s, f) => s + f.amount * ((daysBetween(f.date, endDate) + 0.5) / length),
    0,
  );
  const base = startValue + weighted;
  const gain = endValue - startValue - flow;
  return {
    start: startDate,
    end: endDate,
    startValue,
    endValue,
    flow,
    gain,
    ret: base > 0 ? gain / base : null,
  };
}

/**
 * The portfolio's return from `start` to the last balance, with the cash flows taken out. The span opens at the
 * month end before `start` (or at the first balance, if that is later) and is cut at month ends; each month is a
 * Modified Dietz period and the months are chained, so one large deposit in March cannot distort what the market
 * did in April. Inside a month the line shows the return so far that month.
 *
 * `history` is the daily total of the investment accounts and `flows` the dated money added or taken out. The span
 * never starts before `flowsFrom`, the first day cash flows are known. Returns null when there is nothing to base
 * it on: no known balance at the start, or no day after it.
 */
export function portfolioReturn(
  history: Value[],
  flows: Flow[],
  range: string,
  flowsFrom: string | null = null,
): PortfolioReturn | null {
  const rows = history.filter((h) => h.value !== null);
  if (!rows.length) return null;
  const before = addDays(range, -1);
  const snapped = before === monthEnd(before) ? before : addDays(monthStart(before), -1);
  // Never open before the first balance, nor before `flowsFrom`: before it the cash flows are not recorded, so a
  // deposit would read as growth.
  let opening = snapped < rows[0].date ? rows[0].date : snapped;
  let limit: OpeningLimit = snapped < rows[0].date ? 'balance' : 'range';
  if (flowsFrom && addDays(flowsFrom, -1) > opening) {
    opening = addDays(flowsFrom, -1);
    limit = 'flows';
  }
  const first = valueOn(rows, opening);
  const last = rows[rows.length - 1];
  if (first === null || last.date <= opening) return null;
  const bounds = [opening, ...monthEnds(opening, last.date), last.date];
  const periods: ReturnPeriod[] = [];
  const points: ReturnPoint[] = [{ date: opening, value: first, portfolio: 0 }];
  let chained: number | null = 1;
  for (let i = 1; i < bounds.length; i++) {
    const from = bounds[i - 1];
    const startValue = valueOn(rows, from) ?? first;
    const carried = chained;
    for (const row of rows) {
      if (row.date <= from || row.date > bounds[i]) continue;
      const part = periodReturn(from, row.date, startValue, row.value!, flows);
      points.push({
        date: row.date,
        value: row.value!,
        portfolio:
          carried !== null && part.ret !== null ? (carried * (1 + part.ret) - 1) * 100 : null,
      });
    }
    const whole = periodReturn(from, bounds[i], startValue, valueOn(rows, bounds[i])!, flows);
    periods.push(whole);
    chained = chained !== null && whole.ret !== null ? chained * (1 + whole.ret) : null;
  }
  return {
    from: opening,
    limit,
    to: last.date,
    startValue: first,
    endValue: periods[periods.length - 1].endValue,
    flow: periods.reduce((s, p) => s + p.flow, 0),
    gain: periods.reduce((s, p) => s + p.gain, 0),
    ret: chained === null ? null : chained - 1,
    periods,
    points,
  };
}

/** Why the portfolio return is, or is not, shown. */
export type ReturnStatus =
  | 'ok'
  /** Only some accounts are selected: a bank transfer cannot be assigned to one of them. */
  | 'accounts'
  /** The cash flows could not be loaded. */
  | 'unloaded'
  /** The day cash flows are counted from is after the latest balance, so there is no span. */
  | 'late'
  /** No known balance at the start of the span, or no day after it. */
  | 'nobase';

export function returnStatus(o: {
  wholePortfolio: boolean;
  flowsLoaded: boolean;
  flowsFrom: string | null;
  /** The date of the latest known portfolio balance. */
  lastBalanceDate: string | null;
  result: PortfolioReturn | null;
}): ReturnStatus {
  if (o.result) return 'ok';
  if (!o.wholePortfolio) return 'accounts';
  if (!o.flowsLoaded) return 'unloaded';
  if (o.flowsFrom && o.lastBalanceDate && o.flowsFrom > o.lastBalanceDate) return 'late';
  return 'nobase';
}

/**
 * An account that shows up after the history began adds its whole balance in one day. That is a deposit as far
 * as the return goes, not a gain, so its first balance counts as a flow on that day.
 */
export function appearanceFlows(
  accounts: { id: string }[],
  balances: { account_id: string; date: string; current_balance: string | null }[],
): Flow[] {
  const ids = new Set(accounts.map((a) => a.id));
  const first = new Map<string, { date: string; balance: number }>();
  for (const b of [...balances].sort((a, c) => a.date.localeCompare(c.date)))
    if (ids.has(b.account_id) && b.current_balance !== null && !first.has(b.account_id))
      first.set(b.account_id, { date: b.date, balance: Number(b.current_balance) });
  const all = [...first.values()];
  if (!all.length) return [];
  const began = all.reduce((m, f) => (f.date < m ? f.date : m), all[0].date);
  return all.filter((f) => f.date > began).map((f) => ({ date: f.date, amount: f.balance }));
}

/** The portfolio's value from the day the return opens, so the chart starts where the card says it is counted from. */
export const valueSeries = (r: PortfolioReturn) =>
  r.points.map(({ date, value }) => ({ date, value }));

/** The chart rows for a portfolio return, with a benchmark rebased to zero on the first date. */
export function returnChart(points: ReturnPoint[], benchmarks: Benchmark[]) {
  const lines = rebased(
    points.map((p) => p.date),
    benchmarks,
  );
  return points.map((p, k) => ({
    date: p.date,
    portfolio: p.portfolio,
    benchmark: lines[k],
  }));
}

/** The chart row key of one benchmark (symbols can hold spaces). */
export const benchmarkKey = (symbol: string) => 'bm:' + symbol;

/**
 * Add every benchmark to the chart rows as its own column (percent change from its first level in the
 * range), so the chart can draw them all and the legend can hide any of them.
 */
export function withBenchmarks<T extends { date: string }>(
  rows: T[],
  all: Benchmark[],
  symbols: string[],
  from: string,
): (T & Record<string, number | null>)[] {
  const dates = rows.map((r) => r.date);
  const columns = symbols.map((symbol) => ({
    key: benchmarkKey(symbol),
    values: rebased(dates, benchmarkSeries(all, symbol, from)),
  }));
  return rows.map((row, k) => ({
    ...row,
    ...Object.fromEntries(columns.map((c) => [c.key, c.values[k]])),
  })) as (T & Record<string, number | null>)[];
}
