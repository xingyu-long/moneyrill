import { config } from './lib/config.ts';
import { migrate } from './db/migrate.ts';
import { tokenKeyProblem } from './services/token-crypto.ts';
import { log } from './lib/log.ts';
const keyProblem = tokenKeyProblem();
if (keyProblem) log.error('config.token_key', { problem: keyProblem });
await migrate();
import PgBoss from 'pg-boss';
import { syncAll } from './services/sync.ts';
import { getSyncSchedule } from './services/sync-schedule.ts';
const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();
await boss.createQueue(`${config.plaidEnv}-sync`);
await boss.work(`${config.plaidEnv}-sync`, async () => {
  await syncAll();
});

// The schedule is chosen in Settings, so the worker follows the saved choice and re-applies it when it changes.
let applied = '';
async function applySchedule() {
  const s = await getSyncSchedule();
  const key = JSON.stringify([s.enabled, s.cron, s.timezone]);
  if (key === applied) return;
  if (s.enabled) await boss.schedule(`${config.plaidEnv}-sync`, s.cron, {}, { tz: s.timezone });
  else await boss.unschedule(`${config.plaidEnv}-sync`);
  applied = key;
  console.log(
    s.enabled
      ? `Sync worker ready. Saved connections sync on schedule "${s.cron}" (${s.timezone}) while running.`
      : 'Sync worker ready. Scheduled syncs are off; Sync accounts still runs one on demand.',
  );
}
await applySchedule();
const watch = setInterval(
  () => applySchedule().catch((e) => log.error('sync.schedule', { message: e.message })),
  30_000,
);
process.on('SIGTERM', async () => {
  clearInterval(watch);
  await boss.stop();
  process.exit(0);
});
