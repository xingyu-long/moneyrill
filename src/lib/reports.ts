import Decimal from 'decimal.js';
import type { ReportPeriod, ReportSlice } from '../types.ts';
import { addDays, addMonths, parseIso, toIso } from './calendar.ts';

/** Twelve slice colours (--cat-1 ... --cat-12 in theme.css), so a legend of 12 never repeats. */
export const SLICE_COLORS = Array.from({ length: 12 }, (_, i) => `var(--cat-${i + 1})`);

export type LegendItem = {
  key: string;
  label: string;
  amount: string;
  share: number;
  color: string;
  id?: number;
};

/**
 * The donut and legend: the biggest categories, then the rest as one "Everything else". Categories with no
 * positive amount (refunds can make one negative) cannot be drawn, so they are left out.
 */
export function legend(
  slices: ReportSlice[],
  top = 11,
): { items: LegendItem[]; all: LegendItem[] } {
  const drawn = slices.filter((s) => new Decimal(s.amount).gt(0));
  const items = drawn.map((s, i) => ({
    key: String(s.category.id),
    id: s.category.id,
    label: `${s.category.emoji} ${s.category.name}`.trim(),
    amount: s.amount,
    share: s.share,
    color: SLICE_COLORS[i % SLICE_COLORS.length],
  }));
  if (items.length <= top + 1) return { items, all: items };
  const rest = items.slice(top);
  const sum = rest.reduce((n, r) => n.plus(r.amount), new Decimal(0));
  const share = Math.round(rest.reduce((n, r) => n + r.share, 0) * 10) / 10;
  return {
    items: [
      ...items.slice(0, top),
      {
        key: 'rest',
        label: 'Everything else',
        amount: sum.toFixed(2),
        share,
        color: 'var(--muted)',
      },
    ],
    all: items,
  };
}

const monthName = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

/** The label for a period: "Oct ’25" on the axis, "Oct 2025" when `long` (menus). */
export function periodLabel(p: { start: string }, interval: string, long: boolean) {
  const year = p.start.slice(0, 4);
  if (interval === 'year') return year;
  if (interval === 'quarter')
    return `Q${Math.floor((+p.start.slice(5, 7) - 1) / 3) + 1} ${long ? year : '’' + year.slice(2)}`;
  return `${monthName(p.start)} ${long ? year : '’' + year.slice(2)}`;
}

/** A period as a title: "September 2026", "Q3 2026" or "2026". */
export function periodTitle(p: { start: string }, interval: string) {
  if (interval !== 'month') return periodLabel(p, interval, true);
  return new Date(p.start + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The month, quarter or year holding `today`, as its first and last day. */
export function periodOf(today: string, interval: string) {
  const t = parseIso(today)!;
  const months = interval === 'year' ? 12 : interval === 'quarter' ? 3 : 1;
  const first = interval === 'year' ? 1 : interval === 'quarter' ? t.m - ((t.m - 1) % 3) : t.m;
  const start = toIso(t.y, first, 1);
  return { start, end: addDays(addMonths(start, months), -1) };
}

/** The chart rows: income up, expenses down, and the net line (dashed across unfinished periods). */
export function chartRows(series: ReportPeriod[], interval: string) {
  return series.map((p, i) => {
    const net = Number(p.net);
    const partial = p.partial;
    return {
      start: p.start,
      end: p.end,
      label: periodLabel(p, interval, false),
      income: Number(p.income),
      expenses: -Number(p.expenses),
      net,
      solid: partial ? null : net,
      // the dashed part starts at the last finished period so it joins the solid line
      dashed: partial || (i + 1 < series.length && series[i + 1].partial) ? net : null,
      partial,
    };
  });
}

/** One category's bars: its income or its spending per period (a refund-heavy period can go below zero). */
export function historyRows(series: ReportPeriod[], type: 'income' | 'expense', interval: string) {
  return series.map((p) => {
    const value = type === 'income' ? p.income : p.expenses;
    return {
      start: p.start,
      end: p.end,
      label: periodLabel(p, interval, false),
      value,
      amount: Number(value),
      partial: p.partial,
    };
  });
}

const csvCell = (v: string | number | null) => {
  let s = v === null ? '' : String(v);
  // A cell that starts like a formula would run in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const toCsv = (header: string[], rows: (string | number | null)[][]) =>
  [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The typical amount per period for the history chart's dashed line. A period still in progress would pull it
 * down, so it only counts when it is all there is. Quiet (zero) periods count: it is the average over the range.
 */
export function averageOf(rows: { value: string; partial: boolean }[]): number | null {
  const done = rows.filter((r) => !r.partial);
  const used = done.length ? done : rows;
  if (!used.length) return null;
  return used
    .reduce((sum, r) => sum.plus(r.value), new Decimal(0))
    .div(used.length)
    .toDecimalPlaces(2)
    .toNumber();
}
