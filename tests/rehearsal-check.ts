// Runs inside the candidate image against a throwaway COPY of production data (see
// scripts/rehearse-migrations.sh). Applies pending migrations and proves nothing was lost.
import assert from 'node:assert/strict';
import { migrate } from '../server/db/migrate.ts';
import { pool } from '../server/db/pool.ts';
import { overview, recompute } from '../server/db/queries.ts';

const TABLES = [
  'accounts',
  'balance_snapshots',
  'balance_observations',
  'holding_snapshots',
  'securities',
  'connections',
  'daily_net_worth',
  'benchmark_observations',
  'sync_runs',
  'settings',
];

async function counts() {
  const out: Record<string, number> = {};
  for (const t of TABLES)
    out[t] = Number((await pool.query(`SELECT count(*) FROM ${t}`)).rows[0].count);
  return out;
}
const applied = async () => {
  const exists = (await pool.query("SELECT to_regclass('public.schema_migrations') AS t")).rows[0]
    .t;
  return exists
    ? (await pool.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(
        (r) => r.version,
      )
    : [];
};
const latestNetWorth = async () =>
  (
    await pool.query(
      'SELECT date::text, net_worth::text FROM daily_net_worth ORDER BY date DESC LIMIT 1',
    )
  ).rows[0];

try {
  const before = await counts();
  const versionsBefore = await applied();
  const netBefore = await latestNetWorth();

  await migrate();
  await migrate(); // a second run must change nothing

  const after = await counts();
  const versionsAfter = await applied();
  for (const t of TABLES)
    assert.equal(after[t], before[t], `table ${t} changed row count: ${before[t]} -> ${after[t]}`);
  const data = await overview();
  assert.equal(data.accounts.length, before.accounts, 'overview lost accounts');

  // Recomputing the daily totals from the restored snapshots should reproduce what is stored.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await recompute(client);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  const netAfter = await latestNetWorth();
  assert.deepEqual(netAfter, netBefore, 'latest net worth differs after recompute');

  const added = versionsAfter.filter((v) => !versionsBefore.includes(v));
  console.log(
    JSON.stringify({
      result: 'PASS',
      newMigrations: added,
      rows: Object.fromEntries(TABLES.map((t) => [t, after[t]])),
    }),
  );
} catch (e: any) {
  console.log(JSON.stringify({ result: 'FAIL', reason: e.message }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
