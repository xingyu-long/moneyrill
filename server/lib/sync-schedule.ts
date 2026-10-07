import { z } from 'zod';

export const FREQUENCIES = ['hours', 'days', 'weekly', 'monthly'] as const;
/** Hours that divide the day evenly, so "every N hours" keeps the same times each day. */
export const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12] as const;

/**
 * What the Sync page saves: every N hours, every N days, weekly on a weekday (0 = Sunday) or monthly on a day
 * (1-28, so every month has it), at a time of day (HH:MM, 24 hours; for hours only the minute counts), or off.
 */
export const syncScheduleBody = z
  .object({
    enabled: z.boolean(),
    frequency: z.enum(FREQUENCIES).default('days'),
    every: z.number().int().min(1).max(15).default(1),
    weekday: z.number().int().min(0).max(6).default(1),
    day: z.number().int().min(1).max(28).default(1),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().max(64).refine(isTimeZone),
  })
  .refine((s) => s.frequency !== 'hours' || (HOUR_STEPS as readonly number[]).includes(s.every));
export type SyncSchedule = z.infer<typeof syncScheduleBody>;

export function isTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The five-field cron expression for a schedule. "Every N days" counts from the 1st of each month. */
export function scheduleCron(
  s: Pick<SyncSchedule, 'frequency' | 'every' | 'weekday' | 'day' | 'time'>,
) {
  const [h, m] = s.time.split(':').map(Number);
  if (s.frequency === 'hours') return `${m} ${s.every === 1 ? '*' : `*/${s.every}`} * * *`;
  if (s.frequency === 'weekly') return `${m} ${h} * * ${s.weekday}`;
  if (s.frequency === 'monthly') return `${m} ${h} ${s.day} * *`;
  return `${m} ${h} ${s.every === 1 ? '*' : `*/${s.every}`} * *`;
}

/** The schedule a cron expression stands for, or null for a shape the Settings page cannot show. */
export function cronSchedule(cron: string) {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5 || f[3] !== '*') return null;
  const [mi, h, dom, , dow] = f;
  const num = /^\d{1,2}$/;
  const step = (v: string) => (v === '*' ? 1 : /^\*\/\d{1,2}$/.test(v) ? Number(v.slice(2)) : null);
  if (!num.test(mi) || Number(mi) > 59) return null;
  const pad = (n: string) => n.padStart(2, '0');
  const base = { weekday: 1, day: 1, every: 1 };
  if (dom === '*' && dow === '*' && !num.test(h)) {
    const every = step(h);
    return every && (HOUR_STEPS as readonly number[]).includes(every)
      ? { ...base, frequency: 'hours' as const, every, time: `00:${pad(mi)}` }
      : null;
  }
  if (!num.test(h) || Number(h) > 23) return null;
  const time = `${pad(h)}:${pad(mi)}`;
  if (dom === '*' && /^[0-6]$/.test(dow))
    return { ...base, frequency: 'weekly' as const, weekday: Number(dow), time };
  if (num.test(dom) && dow === '*' && Number(dom) >= 1 && Number(dom) <= 28)
    return { ...base, frequency: 'monthly' as const, day: Number(dom), time };
  const every = dow === '*' ? step(dom) : null;
  return every && every <= 15 ? { ...base, frequency: 'days' as const, every, time } : null;
}
