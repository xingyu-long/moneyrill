import { pool } from '../db/pool.ts';
import { recompute } from '../db/queries.ts';
import { config, validateArchiveEnvironment } from '../lib/config.ts';
import {
  archiveAccount,
  archiveBalance,
  archiveBenchmark,
  archiveHolding,
  archiveSecurity,
  archiveShape,
  ensure,
} from '../lib/schemas.ts';

const tables = [
  'accounts',
  'balance_snapshots',
  'securities',
  'holding_snapshots',
  'benchmark_observations',
  'categories',
  'transactions',
  'transaction_splits',
] as const;
export async function exportArchive() {
  const data: any = {
    version: 1,
    exportedAt: new Date().toISOString(),
    environment: config.plaidEnv,
    tables: {},
  };
  for (const table of tables) {
    data.tables[table] = (await pool.query(`SELECT * FROM ${table}`)).rows.map((r: any) => {
      const rest = { ...r };
      delete rest.connection_id;
      delete rest.provider_id;
      return rest;
    });
  }
  return data;
}

export function accountsCsv(rows: any[]) {
  const escape = (x: any) => {
    let s = String(x ?? '');
    if (/^[=+@-]/.test(s) && !Number.isFinite(Number(s))) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [
    'name,institution,kind,currency,balance,source',
    ...rows.map((r) =>
      [r.name, r.institution, r.kind, r.currency, r.balance, r.source].map(escape).join(','),
    ),
  ].join('\n');
}

export async function importArchive(b: any) {
  ensure(archiveShape, b, 'Select a Moneyrill version 1 JSON archive');
  validateArchiveEnvironment(b);
  const accounts = b.tables.accounts,
    balances = b.tables.balance_snapshots || [],
    holdings = b.tables.holding_snapshots || [],
    securities = b.tables.securities || [];
  if (accounts.length > 500 || balances.length > 300000 || holdings.length > 300000)
    throw new Error('Archive exceeds import limit');
  const accountMap = new Map(accounts.map((a: any) => [a.id, 'import:' + a.id]));
  const securityMap = new Map(securities.map((s: any) => [s.id, 'import:' + s.id]));
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const a of accounts) {
      ensure(archiveAccount, a, 'Invalid account record');
      await c.query(
        `INSERT INTO accounts(id,name,institution,kind,currency,mask,included,source,last_synced) VALUES($1,$2,$3,$4,$5,$6,$7,'imported',now()) ON CONFLICT(id) DO NOTHING`,
        [
          accountMap.get(a.id),
          a.name,
          a.institution,
          a.kind,
          a.currency,
          a.mask,
          a.included !== false,
        ],
      );
    }
    for (const s of securities) {
      ensure(archiveSecurity, s, 'Invalid security record');
      await c.query(`INSERT INTO securities VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`, [
        securityMap.get(s.id),
        s.symbol,
        s.name,
        s.asset_class,
      ]);
    }
    for (const x of balances) {
      ensure(archiveBalance, x, 'Invalid balance record');
      if (!accountMap.has(x.account_id)) throw new Error('Invalid balance record');
      await c.query(
        `INSERT INTO balance_snapshots(account_id,date,current_balance,provenance) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,date) DO NOTHING`,
        [
          accountMap.get(x.account_id),
          x.date,
          x.current_balance,
          x.provenance === 'simulated' ? 'simulated' : 'imported',
        ],
      );
    }
    for (const h of holdings) {
      ensure(archiveHolding, h, 'Invalid holding record');
      if (!accountMap.has(h.account_id) || !securityMap.has(h.security_id))
        throw new Error('Holding refers to an unknown account/security');
      await c.query(
        `INSERT INTO holding_snapshots VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [
          accountMap.get(h.account_id),
          securityMap.get(h.security_id),
          h.date,
          h.quantity,
          h.price,
          h.value,
          h.cost_basis,
          h.provenance === 'simulated' ? 'simulated' : 'imported',
        ],
      );
    }
    for (const x of b.tables.benchmark_observations || []) {
      ensure(archiveBenchmark, x, 'Invalid benchmark record');
      await c.query(
        'INSERT INTO benchmark_observations VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [x.symbol, x.date, x.level, x.provenance],
      );
    }
    await recompute(c);
    await c.query('COMMIT');
    return {
      message: `Imported ${accounts.length} accounts. Re-importing the same archive does not duplicate records.`,
    };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
