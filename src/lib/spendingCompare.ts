// The Home "Spending" chart: money out so far in one period against another, as running totals.
import Decimal from 'decimal.js';
import { addDays, parseIso, shiftMonth, toIso } from './calendar.ts';

export type CompareMode = 'week' | 'month' | 'month-year' | 'average' | 'year';

export const COMPARE_MODES: [CompareMode, string][] = [
  ['week', 'This week vs. last week'],
  ['month', 'This month vs. last month'],
  ['month-year', 'This month vs. last year'],
  ['average', 'This month vs. average month'],
  ['year', 'This year vs. last year'],
];
export const DEFAULT_COMPARE: CompareMode = 'month';
export const isCompareMode = (v: unknown): v is CompareMode => COMPARE_MODES.some(([m]) => m === v);

/** The months that make up the "average month". */
export const AVERAGE_MONTHS = 12;

/** What the comparison needs from the server: per-day (or, for a year, per-month) spending between two days. */
export function comparisonPlan(mode: CompareMode, today: string) {
  const { y, m } = parseIso(today)!;
  if (mode === 'week')
    return { from: addDays(weekStart(today), -7), to: today, interval: 'day' as const };
  if (mode === 'year') return { from: toIso(y - 1, 1, 1), to: today, interval: 'month' as const };
  const back =
    mode === 'month'
      ? shiftMonth(y, m, -1)
      : mode === 'month-year'
        ? { y: y - 1, m }
        : shiftMonth(y, m, -AVERAGE_MONTHS);
  return { from: toIso(back.y, back.m, 1), to: today, interval: 'day' as const };
}

/** The Sunday that starts the week containing `iso` (the calendar picker also starts weeks on Sunday). */
export const weekStart = (iso: string) => {
  const p = parseIso(iso)!;
  return addDays(iso, -new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay());
};

export type SpendPoint = { start: string; expenses: string };
export type CompareRow = { label: string; current: number | null; previous: number | null };
export type Comparison = {
  rows: CompareRow[];
  currentLabel: string;
  previousLabel: string;
  /** Spent so far in the current period. */
  current: Decimal;
  /** What the other period had spent by the same point. */
  previousSoFar: Decimal;
  /** Whether any spending was found at all (to tell "nothing yet" from "no data"). */
  any: boolean;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLong = (y: number, m: number) =>
  new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const round = (n: Decimal) => n.toDecimalPlaces(2).toNumber();

/** Running totals of `amounts` (index 0 = first slot); slots after `count` are null. */
function running(amounts: Decimal[], count: number): (Decimal | null)[] {
  let sum = new Decimal(0);
  return amounts.map((a, i) => (i < count ? (sum = sum.plus(a)) : null));
}

/**
 * The rows of the chart for a mode, from the server's series (`start` + `expenses`). A slot is a day (week,
 * month) or a month (year); a period that has not reached a slot yet has null there so its line stops at today.
 */
export function buildComparison(
  mode: CompareMode,
  today: string,
  series: SpendPoint[],
): Comparison {
  const spent = new Map(series.map((p) => [p.start, new Decimal(p.expenses)]));
  const on = (iso: string) => spent.get(iso) ?? new Decimal(0);
  const t = parseIso(today)!;
  let labels: string[];
  let cur: Decimal[];
  let curCount: number;
  let prev: (Decimal | null)[];
  let currentLabel: string;
  let previousLabel: string;

  if (mode === 'week') {
    const start = weekStart(today);
    const before = addDays(start, -7);
    labels = WEEKDAYS;
    cur = labels.map((_, i) => on(addDays(start, i)));
    curCount = new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay() + 1;
    prev = running(
      labels.map((_, i) => on(addDays(before, i))),
      7,
    );
    currentLabel = 'This week';
    previousLabel = 'Last week';
  } else if (mode === 'year') {
    labels = MONTHS;
    const monthTotal = (y: number, m: number) => {
      const key = toIso(y, m, 1);
      return spent.get(key) ?? new Decimal(0);
    };
    cur = labels.map((_, i) => monthTotal(t.y, i + 1));
    curCount = t.m;
    prev = running(
      labels.map((_, i) => monthTotal(t.y - 1, i + 1)),
      12,
    );
    currentLabel = String(t.y);
    previousLabel = String(t.y - 1);
  } else {
    const length = daysIn(t.y, t.m);
    const monthDays = (y: number, m: number) =>
      Array.from({ length: daysIn(y, m) }, (_, i) => on(toIso(y, m, i + 1)));
    const other = mode === 'month' ? shiftMonth(t.y, t.m, -1) : { y: t.y - 1, m: t.m };
    let previousSlots: (Decimal | null)[];
    if (mode === 'average') {
      // Only months from the first one with spending count, so a new account's empty past does not drag it down.
      const months = Array.from({ length: AVERAGE_MONTHS }, (_, i) =>
        shiftMonth(t.y, t.m, -AVERAGE_MONTHS + i),
      )
        .map(({ y, m }) => monthDays(y, m))
        .filter((days, i, all) => all.slice(0, i + 1).some((d) => d.some((v) => !v.isZero())))
        .map((days) => running(days, days.length));
      previousSlots = Array.from({ length: 31 }, (_, d) => {
        const have = months.filter((m) => m[d] != null);
        return have.length
          ? have.reduce((s, m) => s.plus(m[d]!), new Decimal(0)).div(have.length)
          : null;
      });
      previousLabel = 'Average month';
    } else {
      const days = monthDays(other.y, other.m);
      previousSlots = running(days, days.length);
      previousLabel =
        mode === 'month'
          ? monthLong(other.y, other.m)
          : `${monthLong(other.y, other.m)} ${other.y}`;
    }
    const slots = Math.max(length, mode === 'average' ? 28 : daysIn(other.y, other.m));
    labels = Array.from({ length: slots }, (_, i) => `Day ${i + 1}`);
    cur = Array.from({ length: slots }, (_, i) =>
      i < length ? on(toIso(t.y, t.m, i + 1)) : new Decimal(0),
    );
    curCount = t.d;
    prev = previousSlots
      .slice(0, slots)
      .concat(Array(Math.max(0, slots - previousSlots.length)).fill(null));
    currentLabel = 'This month';
  }

  const now = running(cur, curCount);
  const rows = labels.map((label, i) => ({
    label,
    current: now[i] === null ? null : round(now[i]!),
    previous: prev[i] === null || prev[i] === undefined ? null : round(prev[i]!),
  }));
  const current = now[curCount - 1] ?? new Decimal(0);
  const previousSoFar = prev[curCount - 1] ?? new Decimal(0);
  const any = series.some((p) => !new Decimal(p.expenses).isZero());
  return { rows, currentLabel, previousLabel, current, previousSoFar, any };
}
