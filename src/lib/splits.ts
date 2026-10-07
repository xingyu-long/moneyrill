// Money for splits is handled in whole cents so the parts always add up exactly.
import { addDays, addMonths } from './calendar.ts';

/** `date` null means the same date as the transaction. */
export type DraftPart = {
  amount: string;
  category_id: number | null;
  notes: string;
  date: string | null;
};

export type DateSpacing = 'same' | 'weekly' | 'monthly';

/** "12.5" -> 1250. Null when the text is not an amount with at most two decimals. */
export function parseCents(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export const formatCents = (cents: number) => (cents / 100).toFixed(2);

/** The transaction's amount in cents, ignoring its sign; null if it is not a whole number of cents. */
export function totalCents(amount: string): number | null {
  const n = Math.abs(Number(amount)) * 100;
  return Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-6 ? Math.round(n) : null;
}

/** Cents still to be given to a part (negative when the parts add up to too much). */
export function remainingCents(total: number, parts: DraftPart[]) {
  return total - parts.reduce((sum, p) => sum + (parseCents(p.amount) ?? 0), 0);
}

/** Why the split cannot be saved yet, or null. */
export function draftProblem(total: number, parts: DraftPart[]): string | null {
  if (parts.length < 2) return 'A split needs at least two parts';
  const left = remainingCents(total, parts);
  if (left > 0) return `${formatCents(left)} left to assign`;
  if (left < 0) return `${formatCents(-left)} too much`;
  if (parts.some((p) => !(parseCents(p.amount) ?? 0))) return 'Every part needs an amount';
  return null;
}

/** The body for PUT /transactions/:id/splits: amounts take the transaction's sign. */
export function splitBody(amount: string, parts: DraftPart[]) {
  const sign = Number(amount) < 0 ? '-' : '';
  return {
    splits: parts.map((p) => ({
      amount: sign + formatCents(parseCents(p.amount) ?? 0),
      category_id: p.category_id,
      notes: p.notes,
      date: p.date,
    })),
  };
}

/** Cents for n equal shares; any leftover cents go one each to the first parts, so the total is exact. */
export function evenShares(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Dates for n parts starting on `start`; the first part always keeps the transaction's own date (null). */
export function spreadDates(start: string, n: number, spacing: DateSpacing): (string | null)[] {
  return Array.from({ length: n }, (_, i) => {
    if (i === 0 || spacing === 'same') return null;
    return spacing === 'weekly' ? addDays(start, 7 * i) : addMonths(start, i);
  });
}
