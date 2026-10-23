import { addDays } from './calendar.ts';

export const PERIODS = ['1M', '2M', '3M', '6M', 'YTD', '1Y', 'ALL'];
/** Home's own range: a From and To picked in the hero; the dates live next to the period, not in it. */
export const CUSTOM = 'CUSTOM';
/**
 * Ranges short enough that a day with no snapshot (a sync that runs weekly, a missed day) would leave them empty, and
 * a custom range: these open on the last snapshot on or before their first day.
 */
const OPEN_ON_SNAPSHOT = new Set(['1D', '1W', CUSTOM]);

export function startDate(end: string, period: string) {
  const d = new Date(end + 'T12:00:00Z');
  if (period === 'ALL') return '1900-01-01';
  if (period === 'YTD') return `${d.getUTCFullYear()}-01-01`;
  if (period === '1D') return addDays(end, -1);
  if (period === '1W') return addDays(end, -7);
  d.setUTCMonth(
    d.getUTCMonth() -
      ({ '1M': 1, '2M': 2, '3M': 3, '6M': 6, '1Y': 12 } as Record<string, number>)[period] || 1,
  );
  return d.toISOString().slice(0, 10);
}

/** The day a period's chart opens on, given every day there is a snapshot for (any order). */
export function openingDate(start: string, period: string, dates: Iterable<string>) {
  if (!OPEN_ON_SNAPSHOT.has(period)) return start;
  let best = '';
  for (const d of dates) if (d <= start && d > best) best = d;
  return best || start;
}
