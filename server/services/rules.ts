import { pool } from '../db/pool.ts';
import { log } from '../lib/log.ts';
import { resolveRules, type Conditions, type RuleDef, type RuleInput } from '../lib/rules.ts';
import { ensure, previewRuleBody, ruleOrderBody, saveRuleBody } from '../lib/schemas.ts';

type Db = {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const notFound = Object.assign(new Error('Rule not found'), { statusCode: 404 });
const CHECK = 'Check the conditions (at least one) and the category';

const shape = (r: any) => ({
  id: Number(r.id),
  sort_order: r.sort_order,
  conditions: r.conditions as Conditions,
  category_id: Number(r.category_id),
  category: { id: Number(r.category_id), name: r.category_name, emoji: r.category_emoji },
  last_applied_at: r.last_applied_at,
  last_applied_count: r.last_applied_count,
});

export async function listRules() {
  const rows = (
    await pool.query(
      `SELECT r.*,c.name AS category_name,c.emoji AS category_emoji FROM rules r
       JOIN categories c ON c.id=r.category_id ORDER BY r.sort_order,r.id`,
    )
  ).rows;
  return { rules: rows.map(shape) };
}

async function checkReferences(c: Conditions, categoryId: number) {
  const ids = [categoryId, ...(c.categories ?? [])];
  const found = await pool.query(
    'SELECT count(*)::int AS n FROM categories WHERE id=ANY($1::bigint[])',
    [[...new Set(ids)]],
  );
  if (found.rows[0].n !== new Set(ids).size) throw new Error('Unknown category');
  if (c.accounts?.length) {
    const a = await pool.query('SELECT count(*)::int AS n FROM accounts WHERE id=ANY($1::text[])', [
      [...new Set(c.accounts)],
    ]);
    if (a.rows[0].n !== new Set(c.accounts).size) throw new Error('Unknown account');
  }
}

const ruleDefs = async (db: Db): Promise<RuleDef[]> =>
  (await db.query('SELECT id,conditions,category_id FROM rules ORDER BY sort_order,id')).rows.map(
    (r) => ({ id: Number(r.id), conditions: r.conditions, category_id: Number(r.category_id) }),
  );

/** The category a brokerage row has before any rule: none ("Not counted"). No real category has this id. */
const NOT_COUNTED = 0;

/**
 * Every row a rule looks at: bank and card transactions, and brokerage activity (which has no merchant, so its name is
 * both merchant and statement, and no automatic category). Rows added by hand, split rows and rows you categorised
 * are read too, so a preview can say how many it skipped, but a rule never changes them.
 */
const ROWS_SQL = `SELECT * FROM (
  SELECT 'bank' AS origin,t.id,t.date::text AS date,t.amount::text AS amount,t.account_id,a.name AS account_name,
    coalesce(nullif(t.merchant_name,''),t.name) AS merchant,t.name AS statement,t.source='manual' AS manual,
    t.category_id AS user_category_id,t.rule_id,t.rule_category_id,
    coalesce(ac.id,un.id) AS base_category_id,
    EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id) AS split
  FROM transactions t JOIN accounts a ON a.id=t.account_id
  LEFT JOIN categories ac ON ac.key=t.auto_category_key
  LEFT JOIN categories un ON un.key='uncategorized'
  WHERE t.removed_at IS NULL
  UNION ALL
  SELECT 'investment',i.id,i.date::text,i.amount::text,i.account_id,a.name,i.name,i.name,false,
    i.category_id,i.rule_id,i.rule_category_id,${NOT_COUNTED},false
  FROM investment_transactions i JOIN accounts a ON a.id=i.account_id
  WHERE i.removed_at IS NULL) x`;

const toCandidate = (r: any): Candidate => ({
  ...r,
  base_category_id: Number(r.base_category_id),
  user_category_id: r.user_category_id === null ? null : Number(r.user_category_id),
  rule_id: r.rule_id === null ? null : Number(r.rule_id),
  rule_category_id: r.rule_category_id === null ? null : Number(r.rule_category_id),
});

type Candidate = {
  origin: 'bank' | 'investment';
  manual: boolean;
  id: string;
  date: string;
  merchant: string;
  account_name: string;
  amount: string;
  user_category_id: number | null;
  rule_id: number | null;
  rule_category_id: number | null;
  base_category_id: number;
  split: boolean;
} & RuleInput;

/**
 * What a rule would do to the transactions today: rows where it becomes the winner with a new category, and rows it
 * wins now but would lose. `rules` is the whole list with this rule in its place. Nothing is written here.
 */
async function plan(db: Db, rules: RuleDef[], target: number | null) {
  const rows = (await db.query(ROWS_SQL)).rows.map(toCandidate);
  const skipped = { edited: 0, split: 0, manual: 0 };
  const changes: {
    row: Candidate;
    next: { rule_id: number | null; category_id: number } | null;
  }[] = [];
  let matching = 0;
  for (const row of rows) {
    const next = resolveRules(rules, row, row.base_category_id);
    const wins = next?.rule_id === target;
    if (wins && row.manual) skipped.manual++;
    else if (wins && row.split) skipped.split++;
    else if (wins && row.user_category_id !== null) skipped.edited++;
    if (row.manual || row.split || row.user_category_id !== null) continue;
    if (wins) matching++;
    const was = row.rule_id === target && target !== null;
    if (!wins && !was) continue;
    const before = row.rule_category_id ?? row.base_category_id;
    const after = next?.category_id ?? row.base_category_id;
    if (before !== after || (was && !wins)) changes.push({ row, next });
  }
  return { changes, matching, skipped };
}

/** The category names for a preview: id → name and emoji ("Not counted" for brokerage activity without one). */
async function categoryNames() {
  const rows = (await pool.query('SELECT id,name,emoji FROM categories')).rows;
  return new Map<number, { id: number; name: string; emoji: string | null }>([
    [NOT_COUNTED, { id: NOT_COUNTED, name: 'Not counted', emoji: null }],
    ...rows.map((c: any): [number, { id: number; name: string; emoji: string | null }] => [
      Number(c.id),
      { id: Number(c.id), name: c.name, emoji: c.emoji },
    ]),
  ]);
}

/** Rules in order, with the one being previewed put in its place (or last when it is new). */
async function withCandidate(
  body: { conditions: Conditions; category_id: number },
  ruleId?: number,
) {
  const rules = await ruleDefs(pool);
  if (ruleId !== undefined && !rules.some((r) => r.id === ruleId)) throw notFound;
  const candidate: RuleDef = { id: ruleId ?? null, ...body };
  return ruleId === undefined
    ? [...rules, candidate]
    : rules.map((r) => (r.id === ruleId ? candidate : r));
}

const PREVIEW_ROWS = 200;

/** What saving this rule and updating existing transactions would change. */
export async function previewRule(body: unknown) {
  const b = ensure(previewRuleBody, body, CHECK);
  await checkReferences(b.conditions, b.category_id);
  const { changes, matching, skipped } = await plan(
    pool,
    await withCandidate(b, b.rule_id),
    b.rule_id ?? null,
  );
  const names = await categoryNames();
  const current = (r: Candidate) => names.get(r.rule_category_id ?? r.base_category_id)!;
  return {
    matching,
    skipped,
    total: changes.length,
    changes: changes.slice(0, PREVIEW_ROWS).map(({ row, next }) => ({
      id: row.id,
      date: row.date,
      merchant: row.merchant,
      account: row.account_name,
      amount: row.amount,
      from: current(row),
      to: names.get(next?.category_id ?? row.base_category_id)!,
    })),
  };
}

/** Write exactly what `plan` found. Returns how many transactions changed. */
async function writeChanges(db: Db, changes: Awaited<ReturnType<typeof plan>>['changes']) {
  for (const [origin, table] of [
    ['bank', 'transactions'],
    ['investment', 'investment_transactions'],
  ] as const) {
    const these = changes.filter((c) => c.row.origin === origin);
    if (!these.length) continue;
    await db.query(
      `UPDATE ${table} t SET rule_id=x.rule_id,rule_category_id=x.cat,updated_at=now()
       FROM unnest($1::text[],$2::bigint[],$3::bigint[]) AS x(id,rule_id,cat) WHERE t.id=x.id`,
      [
        these.map((c) => c.row.id),
        these.map((c) => c.next?.rule_id ?? null),
        these.map((c) => c.next?.category_id ?? null),
      ],
    );
  }
  return changes.length;
}

async function applyOne(db: Db, id: number) {
  const { changes } = await plan(db, await ruleDefs(db), id);
  const updated = await writeChanges(db, changes);
  await db.query('UPDATE rules SET last_applied_at=now(),last_applied_count=$2 WHERE id=$1', [
    id,
    updated,
  ]);
  return updated;
}

async function transaction<T>(fn: (db: Db) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function createRule(body: unknown) {
  const b = ensure(saveRuleBody, body, CHECK);
  await checkReferences(b.conditions, b.category_id);
  const { id, updated } = await transaction(async (db) => {
    const next = (await db.query('SELECT coalesce(max(sort_order),0)+1 AS n FROM rules')).rows[0].n;
    const id = Number(
      (
        await db.query(
          'INSERT INTO rules(sort_order,conditions,category_id) VALUES($1,$2,$3) RETURNING id',
          [next, JSON.stringify(b.conditions), b.category_id],
        )
      ).rows[0].id,
    );
    return { id, updated: b.apply ? await applyOne(db, id) : null };
  });
  log.info('rules.created', { id, updated });
  return { ...(await oneRule(id)), updated };
}

async function oneRule(id: number) {
  const r = (await listRules()).rules.find((x) => x.id === id);
  if (!r) throw notFound;
  return { rule: r };
}

export async function updateRule(id: number, body: unknown) {
  const b = ensure(saveRuleBody, body, CHECK);
  await checkReferences(b.conditions, b.category_id);
  const updated = await transaction(async (db) => {
    const r = await db.query(
      'UPDATE rules SET conditions=$2,category_id=$3,updated_at=now() WHERE id=$1',
      [id, JSON.stringify(b.conditions), b.category_id],
    );
    if (!r.rowCount) throw notFound;
    return b.apply ? await applyOne(db, id) : null;
  });
  log.info('rules.updated', { id, updated });
  return { ...(await oneRule(id)), updated };
}

/** `revert` puts the transactions this rule categorised back to their automatic category (or "Not counted"). */
export async function deleteRule(id: number, revert: boolean) {
  return transaction(async (db) => {
    let reverted = 0;
    if (revert)
      for (const table of ['transactions', 'investment_transactions'])
        reverted +=
          (
            await db.query(
              `UPDATE ${table} SET rule_id=NULL,rule_category_id=NULL,updated_at=now() WHERE rule_id=$1`,
              [id],
            )
          ).rowCount ?? 0;
    const r = await db.query('DELETE FROM rules WHERE id=$1', [id]);
    if (!r.rowCount) throw notFound;
    return { ok: true, reverted };
  });
}

export async function applyRule(id: number) {
  const updated = await transaction((db) => applyOne(db, id));
  return { updated };
}

/** The rules in the order dragged: `ids` must be every rule exactly once. */
export async function reorderRules(body: unknown) {
  const b = ensure(ruleOrderBody, body, 'Send every rule id once');
  await transaction(async (db) => {
    const have = (await db.query('SELECT id FROM rules')).rows.map((r) => Number(r.id)).sort();
    if (JSON.stringify([...b.ids].sort()) !== JSON.stringify(have))
      throw new Error('Send every rule id once');
    await db.query(
      'UPDATE rules r SET sort_order=x.n FROM unnest($1::bigint[]) WITH ORDINALITY AS x(id,n) WHERE r.id=x.id',
      [b.ids],
    );
  });
  return listRules();
}

/**
 * Give freshly synced rows their rule result (a winning rule, or none): bank and card transactions, or brokerage
 * activity (`origin`). Skips rows you categorised yourself, split ones and ones you added. Runs inside the sync's own
 * database transaction, behind a savepoint: a problem with a rule is logged and never costs the sync its data.
 */
export async function applyRulesToSynced(
  db: Db,
  ids: string[],
  origin: 'bank' | 'investment' = 'bank',
) {
  if (!ids.length) return 0;
  await db.query('SAVEPOINT rules');
  try {
    const rules = await ruleDefs(db);
    if (!rules.length) {
      await db.query('RELEASE SAVEPOINT rules');
      return 0;
    }
    const rows = (
      await db.query(`${ROWS_SQL} WHERE x.origin=$1 AND x.id=ANY($2::text[])`, [origin, ids])
    ).rows.map(toCandidate);
    const changes = rows
      .filter((r) => r.user_category_id === null && !r.split && !r.manual)
      .map((row) => ({ row, next: resolveRules(rules, row, row.base_category_id) }));
    await writeChanges(db, changes);
    await db.query('RELEASE SAVEPOINT rules');
    return changes.filter((c) => c.next).length;
  } catch (e: any) {
    await db.query('ROLLBACK TO SAVEPOINT rules');
    log.warn('rules.sync_failed', { message: String(e?.message ?? e).slice(0, 200) });
    return 0;
  }
}
