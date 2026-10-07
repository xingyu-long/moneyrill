// Run only against a disposable (empty) database: DATABASE_URL=.../migtest tsx tests/migrations-db.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { orderMigrations } from '../server/db/migration-files.ts';
import { migrate } from '../server/db/migrate.ts';
import { pool } from '../server/db/pool.ts';

await migrate();
await migrate(); // second run must be a no-op
const applied = (await pool.query('SELECT version FROM schema_migrations ORDER BY version')).rows;
assert.deepEqual(
  applied.map((r: any) => r.version),
  orderMigrations(fs.readdirSync(new URL('../server/db/migrations/', import.meta.url))),
);
const tables = (
  await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
).rows.map((r: any) => r.table_name);
for (const t of [
  'accounts',
  'balance_snapshots',
  'balance_observations',
  'holding_snapshots',
  'connections',
  'daily_net_worth',
  'settings',
  'sync_runs',
  'securities',
  'benchmark_observations',
  'categories',
  'category_groups',
  'transactions',
  'transaction_splits',
])
  assert.ok(tables.includes(t), `missing table ${t}`);
assert.equal(
  (await pool.query("SELECT value FROM settings WHERE key='environment'")).rows[0].value,
  'sandbox',
);

// Default categories are seeded once (the second migrate above must not duplicate them).
const keys = (await pool.query('SELECT key FROM categories')).rows.map((r: any) => r.key);
assert.equal(keys.length, 38);
assert.equal(new Set(keys).size, keys.length);
for (const key of ['groceries', 'transfer', 'paychecks', 'uncategorized'])
  assert.ok(keys.includes(key));
await pool.query(
  "INSERT INTO accounts(id,name,institution,kind,source) VALUES('m','m','m','cash','manual')",
);
await pool.query(
  "INSERT INTO transactions(id,account_id,date,amount,name,provenance) VALUES('m:1','m','2026-10-01',5,'x','test')",
);
assert.equal((await pool.query("SELECT notes FROM transactions WHERE id='m:1'")).rows[0].notes, '');
await pool.query("DELETE FROM accounts WHERE id='m'");
assert.equal(
  (await pool.query('SELECT 1 FROM transactions')).rowCount,
  0,
  'transactions go with their account',
);

// An applied migration that was edited must be refused.
await pool.query("UPDATE schema_migrations SET checksum='tampered'");
await assert.rejects(migrate(), /changed after it was applied/);
console.log('PASS: fresh migrate, idempotent re-run, tracked versions, edited migration refused');
await pool.end();
