// The Date popover on the Reports tab: what the owner picked, and the calendar days it stands for.
import { addDays, addMonths, dayLabel, parseIso, toIso } from './calendar.ts';

export type Unit = 'day' | 'week' | 'month' | 'quarter' | 'year';
export const UNITS: Unit[] = ['day', 'week', 'month', 'quarter', 'year'];
/** Largest N per unit, so a typo cannot reach before the 1900s. */
export const MAX_N: Record<Unit, number> = {
  day: 36500,
  week: 5200,
  month: 1200,
  quarter: 400,
  year: 100,
};

export const PRESETS = [
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'thisYear', label: 'This year' },
  { id: 'lastYear', label: 'Last year' },
] as const;
export type PresetId = (typeof PRESETS)[number]['id'];

export type DateSpec =
  | { mode: 'all' }
  | { mode: 'preset'; id: PresetId }
  | { mode: 'last'; n: number; unit: Unit }
  | { mode: 'range'; from: string; to: string };

export const ALL_TIME: DateSpec = { mode: 'all' };
/** What Reports opens on when the address names no range. */
export const DEFAULT_DATE: DateSpec = { mode: 'preset', id: 'thisYear' };
export const THIS_MONTH: DateSpec = { mode: 'preset', id: 'thisMonth' };

const monthsPer: Record<Unit, number> = { day: 0, week: 0, month: 1, quarter: 3, year: 12 };

/** The last N days, weeks, months, quarters or years up to and including `today`. */
export function lastRange(n: number, unit: Unit, today: string) {
  const from =
    unit === 'day'
      ? addDays(today, -(n - 1))
      : unit === 'week'
        ? addDays(today, -(7 * n - 1))
        : addDays(addMonths(today, -n * monthsPer[unit]), 1);
  return { from, to: today };
}

/** The first and last day a spec stands for; no bounds at all means all time. */
export function resolveSpec(spec: DateSpec, today: string): { from?: string; to?: string } {
  if (spec.mode === 'all') return {};
  if (spec.mode === 'range') return { from: spec.from, to: spec.to };
  if (spec.mode === 'last') return lastRange(spec.n, spec.unit, today);
  const t = parseIso(today)!;
  switch (spec.id) {
    case 'last7':
      return lastRange(7, 'day', today);
    case 'last30':
      return lastRange(30, 'day', today);
    case 'thisMonth':
      return { from: toIso(t.y, t.m, 1), to: today };
    case 'lastMonth': {
      const first = addMonths(toIso(t.y, t.m, 1), -1);
      return { from: first, to: addDays(toIso(t.y, t.m, 1), -1) };
    }
    case 'thisYear':
      return { from: toIso(t.y, 1, 1), to: today };
    case 'lastYear':
      return { from: toIso(t.y - 1, 1, 1), to: toIso(t.y - 1, 12, 31) };
  }
}

export function specLabel(spec: DateSpec) {
  if (spec.mode === 'all') return 'All time';
  if (spec.mode === 'preset') return PRESETS.find((p) => p.id === spec.id)?.label ?? 'All time';
  if (spec.mode === 'last') return `Last ${spec.n} ${spec.unit}${spec.n === 1 ? '' : 's'}`;
  return rangeLabel(spec.from, spec.to);
}

export const rangeLabel = (from: string | null, to: string | null) =>
  from && to
    ? `${shortDay(from)} – ${shortDay(to)}`
    : from
      ? `From ${shortDay(from)}`
      : to
        ? `Until ${shortDay(to)}`
        : 'All time';

export const shortDay = (iso: string) => dayLabel(iso).replace(/^(\w{3})\w*/, '$1');

/** Accept only a spec that came from this module's types (it is read back from local storage). */
export function parseSpec(v: any): DateSpec {
  try {
    if (v?.mode === 'preset' && PRESETS.some((p) => p.id === v.id))
      return { mode: 'preset', id: v.id };
    if (
      v?.mode === 'last' &&
      UNITS.includes(v.unit) &&
      Number.isInteger(v.n) &&
      v.n >= 1 &&
      v.n <= MAX_N[v.unit as Unit]
    )
      return { mode: 'last', n: v.n, unit: v.unit };
    if (v?.mode === 'range' && parseIso(v.from) && parseIso(v.to) && v.from <= v.to)
      return { mode: 'range', from: v.from, to: v.to };
  } catch {
    // fall through to all time
  }
  return ALL_TIME;
}
