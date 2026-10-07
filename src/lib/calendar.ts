// Calendar math on plain "YYYY-MM-DD" strings, so no time zone can shift a day.
export const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function parseIso(v: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d
    ? { y, m, d }
    : null;
}

export const todayIso = () => {
  const n = new Date();
  return toIso(n.getFullYear(), n.getMonth() + 1, n.getDate());
};

export const addDays = (iso: string, days: number) => {
  const p = parseIso(iso)!;
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
};

export const monthTitle = (y: number, m: number) =>
  new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const dayLabel = (iso: string) => {
  const p = parseIso(iso)!;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

/** The weeks (Sunday first) shown for a month, including the neighbouring months' days. */
export function monthGrid(y: number, m: number) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = addDays(toIso(y, m, 1), -first);
  const weeks = Math.ceil((first + length) / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const iso = addDays(start, w * 7 + d);
      return { iso, day: parseIso(iso)!.d, inMonth: parseIso(iso)!.m === m };
    }),
  );
}

export const shiftMonth = (y: number, m: number, by: number) => {
  const total = y * 12 + (m - 1) + by;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
};

/** The same day-of-month some months later, or the month's last day when it has no such day. */
export function addMonths(iso: string, months: number) {
  const p = parseIso(iso)!;
  const { y, m } = shiftMonth(p.y, p.m, months);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return toIso(y, m, Math.min(p.d, last));
}
