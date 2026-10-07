import { pool } from '../db/pool.ts';
import { config } from '../lib/config.ts';
import { ensure } from '../lib/schemas.ts';
import { cronSchedule, scheduleCron, syncScheduleBody } from '../lib/sync-schedule.ts';

const SETTING = 'sync_schedule';

/**
 * When the worker syncs: the choice saved in Settings, else the SYNC_CRON / SYNC_TIMEZONE of the deployment.
 * `frequency` is null when the deployment's cron has a shape Settings cannot show; saving here replaces it.
 */
export async function getSyncSchedule() {
  const row = (await pool.query(`SELECT value FROM settings WHERE key=$1`, [SETTING])).rows[0]
    ?.value;
  const saved = row ? syncScheduleBody.safeParse(row).data : undefined;
  const fallback = {
    enabled: true,
    ...(cronSchedule(config.syncCron) ?? {
      frequency: null,
      every: 1,
      weekday: 1,
      day: 1,
      time: '13:00',
    }),
    timezone: config.syncTimezone,
  };
  const s = saved ?? fallback;
  return {
    ...s,
    cron: s.frequency ? scheduleCron({ ...s, frequency: s.frequency }) : config.syncCron,
    source: saved ? ('settings' as const) : ('default' as const),
    default: fallback,
  };
}

/** Save the schedule, or pass { reset: true } to go back to the deployment's default. The worker picks the change up itself. */
export async function setSyncSchedule(body: unknown) {
  if ((body as { reset?: unknown } | null)?.reset === true)
    await pool.query(`DELETE FROM settings WHERE key=$1`, [SETTING]);
  else {
    const s = ensure(
      syncScheduleBody,
      body,
      'Choose how often, a time such as 13:00 and a time zone such as America/New_York',
    );
    await pool.query(
      `INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=excluded.value`,
      [SETTING, JSON.stringify(s)],
    );
  }
  return getSyncSchedule();
}
