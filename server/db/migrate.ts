import fs from 'node:fs/promises';
import { config } from '../lib/config.ts';
import { log } from '../lib/log.ts';
import { checksum, orderMigrations } from './migration-files.ts';
import { pool } from './pool.ts';

const dir = new URL('./migrations/', import.meta.url);

/**
 * Apply any new migrations, then confirm this database belongs to the running environment.
 * Applied migrations are never re-run, and editing one after the fact is refused.
 */
export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(931879)');
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map<string, string>(
      (await c.query('SELECT version, checksum FROM schema_migrations')).rows.map((r: any) => [
        r.version,
        r.checksum,
      ]),
    );
    for (const name of orderMigrations(await fs.readdir(dir))) {
      const sql = await fs.readFile(new URL(name, dir), 'utf8');
      const sum = checksum(sql);
      const previous = applied.get(name);
      if (previous) {
        if (previous !== sum)
          throw new Error(`Migration ${name} was changed after it was applied; add a new one`);
        continue;
      }
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(version, checksum) VALUES($1,$2)', [name, sum]);
      log.info('db.migration_applied', { version: name });
    }
    const saved = (await c.query("SELECT value FROM settings WHERE key='environment'")).rows[0];
    if (saved && saved.value !== config.plaidEnv)
      throw new Error('Database belongs to a different environment; refusing to start');
    const mixed = (
      await c.query('SELECT 1 FROM connections WHERE environment<>$1 LIMIT 1', [config.plaidEnv])
    ).rowCount;
    const demo =
      config.production &&
      (
        await c.query(
          "SELECT 1 FROM accounts WHERE source IN ('simulated','plaid_sandbox') LIMIT 1",
        )
      ).rowCount;
    if (mixed || demo)
      throw new Error('Database contains data from a different environment; refusing to start');
    await c.query(
      "INSERT INTO settings(key,value) VALUES('environment',$1) ON CONFLICT DO NOTHING",
      [JSON.stringify(config.plaidEnv)],
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
