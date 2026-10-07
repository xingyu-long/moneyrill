import type { PoolClient } from 'pg';
import { pool } from '../db/pool.ts';
import { log } from '../lib/log.ts';
import { ensure, monarchImportBody } from '../lib/schemas.ts';
import { parseMonarchCsv, planMonarchImport, type Plan } from '../lib/monarch.ts';

type Db = Pick<PoolClient, 'query'>;
const GROUP = 'Imported from Monarch';

async function load(db: Db) {
  const accounts = (
    await db.query(
      `SELECT id,name,institution,mask FROM accounts WHERE kind IN ('cash','credit') AND mask IS NOT NULL`,
    )
  ).rows;
  const ids = accounts.map((a: any) => a.id);
  const plaid = (
    await db.query(
      `SELECT id,account_id,date::text,amount::text,category_id,notes FROM transactions
       WHERE source='plaid' AND removed_at IS NULL AND pending=false AND account_id = ANY($1::text[])`,
      [ids],
    )
  ).rows.map((r: any) => ({
    ...r,
    category_id: r.category_id === null ? null : Number(r.category_id),
  }));
  const importedIds = new Set<string>(
    (await db.query(`SELECT external_id FROM transactions WHERE source='monarch'`)).rows.map(
      (r: any) => r.external_id,
    ),
  );
  const cats = (await db.query('SELECT id,lower(name) AS name,key FROM categories')).rows;
  return {
    accounts,
    plaid,
    importedIds,
    categories: new Map<string, number>(cats.map((c: any) => [c.name, Number(c.id)])),
    uncategorizedId: Number(cats.find((c: any) => c.key === 'uncategorized')?.id) || null,
  };
}

/** What the screen shows: counts only, never the rows themselves. */
function summarize(plan: Plan, invalidLines: number[]) {
  return {
    accounts: plan.accounts,
    newCategories: plan.newCategories,
    futureRows: plan.futureRows,
    totals: plan.totals,
    unreadableRows: invalidLines.length,
    unreadableLines: invalidLines.slice(0, 20),
  };
}

async function apply(db: Db, plan: Plan) {
  // New categories go into "Imported from Monarch" (an income group if every row was money in).
  const made = new Map<string, number>();
  for (const c of plan.newCategories) {
    const type = c.income ? 'income' : 'expense';
    const group = (
      await db.query(
        `INSERT INTO category_groups(type,name,sort_order)
         VALUES($1,$2,(SELECT coalesce(max(sort_order),0)+10 FROM category_groups WHERE type=$1))
         ON CONFLICT (type, lower(name)) DO UPDATE SET name=category_groups.name RETURNING id`,
        [type, GROUP],
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO categories(name,group_name,group_id,emoji,sort_order)
       VALUES($1,$2,$3,'',(SELECT coalesce(max(sort_order),0)+1 FROM categories WHERE group_id=$3))
       ON CONFLICT DO NOTHING`,
      [c.name, GROUP, group],
    );
    const id = (await db.query('SELECT id FROM categories WHERE lower(name)=lower($1)', [c.name]))
      .rows[0].id;
    made.set(c.name.toLowerCase(), Number(id));
  }
  const category = (id: number | null, fresh: string | null) =>
    id ?? (fresh ? (made.get(fresh.toLowerCase()) ?? null) : null);

  let imported = 0;
  for (let i = 0; i < plan.insert.length; i += 1000) {
    const batch = plan.insert.slice(i, i + 1000).map((t) => ({
      id: 'monarch:' + t.external_id,
      account_id: t.account_id,
      external_id: t.external_id,
      date: t.date,
      amount: t.amount,
      name: t.name,
      merchant_name: t.merchant_name,
      notes: t.notes,
      category_id: category(t.category_id, t.new_category),
    }));
    const r = await db.query(
      `INSERT INTO transactions(id,account_id,source,external_id,date,amount,currency,name,merchant_name,pending,provenance,category_id,notes)
       SELECT id,account_id,'monarch',external_id,date,amount,'USD',name,merchant_name,false,'monarch_import',category_id,notes
       FROM jsonb_to_recordset($1::jsonb) AS x(id text,account_id text,external_id text,date date,amount numeric,name text,merchant_name text,notes text,category_id bigint)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
      [JSON.stringify(batch)],
    );
    imported += r.rowCount ?? 0;
  }
  // Matching Plaid rows only gain what is still empty: your own choices are never overwritten.
  let merged = 0;
  if (plan.merge.length) {
    const r = await db.query(
      `UPDATE transactions t SET category_id=coalesce(t.category_id,x.cat),
         notes=CASE WHEN t.notes='' THEN x.notes ELSE t.notes END, updated_at=now()
       FROM unnest($1::text[],$2::bigint[],$3::text[]) AS x(id,cat,notes)
       WHERE t.id=x.id AND ((t.category_id IS NULL AND x.cat IS NOT NULL) OR (t.notes='' AND x.notes<>''))`,
      [
        plan.merge.map((m) => m.id),
        plan.merge.map((m) => category(m.category_id, m.new_category)),
        plan.merge.map((m) => m.notes),
      ],
    );
    merged = r.rowCount ?? 0;
  }
  return { imported, merged, categoriesCreated: made.size };
}

/** Dry run (commit false) reads and plans; commit applies the same plan in one database transaction. */
export async function importMonarch(body: unknown) {
  const b = ensure(monarchImportBody, body, 'Send the CSV text and whether to import it');
  const { rows, invalidLines } = parseMonarchCsv(b.csv);
  const today = new Date().toISOString().slice(0, 10);
  if (!b.commit) {
    const plan = planMonarchImport({ rows, today, ...(await load(pool)) });
    return { committed: false, ...summarize(plan, invalidLines) };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Never overlap a sync: both would be changing transactions.
    const free = (await client.query('SELECT pg_try_advisory_xact_lock(931877) AS ok')).rows[0].ok;
    if (!free) throw new Error('A sync is running. Try the import again in a minute.');
    const plan = planMonarchImport({ rows, today, ...(await load(client)) });
    const applied = await apply(client, plan);
    await client.query('COMMIT');
    log.info('monarch.import', { rows: rows.length, ...applied });
    return { committed: true, applied, ...summarize(plan, invalidLines) };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
