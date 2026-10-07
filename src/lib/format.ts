/** The category colours (--cat-1 ... --cat-8 in theme.css), so light and dark each get their own shades. */
export const COLORS = Array.from({ length: 8 }, (_, i) => `var(--cat-${i + 1})`);

/** Private mode hides every amount and share count; percentages stay visible. */
let privateMode = false;
export const isPrivate = () => privateMode;
export const setPrivateMode = (on: boolean) => {
  privateMode = on;
};
export const MASK = '••••••';

/** Plain dollar formatting. Use directly only for public figures such as a security's price. */
export const price = (v: number | null | undefined, compact = false) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : 2,
      }).format(v);

/** Your own money: masked in private mode. */
export const cash = (v: number | null | undefined, compact = false) =>
  v == null || !Number.isFinite(v) ? '—' : privateMode ? MASK : price(v, compact);

/** Whole dollars, for a figure inside a sentence ("$80,940"); masked in private mode like cash. */
export const cashWhole = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : privateMode
      ? MASK
      : new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 0,
        }).format(v);

/** Share counts (or any quantity you hold): masked in private mode. */
export const shares = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : privateMode
      ? MASK
      : new Intl.NumberFormat('en-US', { maximumFractionDigits: 5 }).format(v);

export const number = (v: any) => (v == null ? null : Number(v));

export const percent = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

/** A part's share of a whole as "35.9%"; unavailable when the whole is not positive. */
export const share = (part: number, whole: number) =>
  whole > 0 && Number.isFinite(part) ? `${((part / whole) * 100).toFixed(1)}%` : '—';

export const delta = (end: number, start: number | null) => (start === null ? null : end - start);

/** Percent change; unavailable when the baseline is zero, negative or unknown. */
export const pct = (end: number, start: number | null) =>
  start === null || start <= 0 ? null : (end / start - 1) * 100;

export const dateLabel = (v: string) =>
  new Date(v + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** With the year ("Jan 9, 2026"), for chart tooltips: a long history crosses years. */
export const dateLabelYear = (v: string) =>
  new Date(v + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
