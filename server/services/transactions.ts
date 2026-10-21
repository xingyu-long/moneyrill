import crypto from 'node:crypto';
import { pool } from '../db/pool.ts';
import { config } from '../lib/config.ts';
import { log } from '../lib/log.ts';
import {
  createTransactionBody,
  ensure,
  splitsBody,
  transactionQuery,
  updateTransactionBody,
} from '../lib/schemas.ts';
import {
  mapProviderCategory,
  matchResentTransactions,
  planTransactionChanges,
  type Changes,
  QUIET_TRANSACTION_ERRORS,
  splitProblem,
  splitsBalance,
  type SyncPage,
} from '../lib/transactions.ts';
import { lineKindSql, MERCHANT_SQL } from '../lib/reports.ts';
import { plaid } from './plaid-client.ts';
import { applyRulesToSynced } from './rules.ts';

const CARD_OR_BANK = ['cash', 'credit'];

/**
 * Pull new bank and card transactions for one Item. Runs after the balances are saved, in its own
 * database transaction: a failure here never rolls back balances. Returns an error code, or null.
 */
export async function syncTransactions(
  connection: { id: string },
  access_token: string,
  rematched: Map<string, string> = new Map(),
) {
  const accounts = new Map<string, string>(
    (
      await pool.query(
        'SELECT id, provider_id FROM accounts WHERE connection_id=$1 AND kind = ANY($2::text[])',
        [connection.id, CARD_OR_BANK],
      )
    ).rows.map((r: any) => [r.provider_id, r.id]),
  );
  if (!accounts.size) return null;
  const saved: string | null =
    (await pool.query('SELECT transactions_cursor FROM connections WHERE id=$1', [connection.id]))
      .rows[0]?.transactions_cursor ?? null;
  try {
    let pages: SyncPage[] = [];
    let cursor = saved;
    for (let attempt = 0; ; attempt++) {
      pages = [];
      cursor = saved;
      try {
        for (;;) {
          const r = (
            await plaid.transactionsSync({
              access_token,
              cursor: cursor || undefined,
              count: 500,
              options: { include_personal_finance_category: true },
            })
          ).data;
          pages.push({ added: r.added, modified: r.modified, removed: r.removed } as SyncPage);
          cursor = r.next_cursor;
          if (!r.has_more) break;
        }
        break;
      } catch (e: any) {
        // Data changed while paging: start again from the saved cursor.
        if (
          e.response?.data?.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' &&
          attempt < 2
        )
          continue;
        throw e;
      }
    }
    const changes = planTransactionChanges(
      connection.id,
      pages,
      accounts,
      `plaid_${config.plaidEnv}`,
    );
    if (rematched.size) {
      // Accounts re-matched in this sync may be sent again under new transaction ids.
      const saved = (
        await pool.query(
          `SELECT id,account_id,date::text AS date,amount::text AS amount,name FROM transactions
           WHERE account_id=ANY($1::text[]) AND source='plaid' AND removed_at IS NULL AND NOT pending`,
          [[...rematched.keys()]],
        )
      ).rows;
      const resent = matchResentTransactions(
        changes.upserts,
        saved,
        rematched,
        new Set(changes.carryOver.map((c) => c.toId)),
      );
      changes.carryOver.push(...resent.carryOver);
      changes.removeIds.push(...resent.removeIds);
      if (resent.carryOver.length)
        log.info('sync.transactions_resent', {
          connection: connection.id,
          matched: resent.carryOver.length,
        });
    }
    await applyTransactionChanges(connection.id, changes, cursor);
    log.info('sync.transactions', {
      connection: connection.id,
      added: changes.upserts.length,
      removed: changes.removeIds.length,
      skipped: changes.skipped,
    });
    return null;
  } catch (e: any) {
    const code = e.response?.data?.error_code || 'SYNC_FAILED';
    if (QUIET_TRANSACTION_ERRORS.includes(code)) {
      log.info('sync.transactions_skipped', { connection: connection.id, code });
      return null;
    }
    log.warn('sync.transactions_failed', { connection: connection.id, code });
    return 'TRANSACTIONS_' + code;
  }
}

/** Save one sync's changes and the new cursor together, so the cursor never moves ahead of the data. */
export async function applyTransactionChanges(
  connectionId: string,
  changes: Changes,
  cursor: string | null,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of changes.upserts)
      await client.query(
        `INSERT INTO transactions(id,account_id,provider_id,source,date,authorized_date,amount,currency,name,merchant_name,pending,pending_transaction_id,provider_category,provider_category_detailed,auto_category_key,provenance)
         VALUES($1,$2,$3,'plaid',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT(id) DO UPDATE SET date=excluded.date,authorized_date=excluded.authorized_date,amount=excluded.amount,currency=excluded.currency,name=excluded.name,merchant_name=excluded.merchant_name,pending=excluded.pending,pending_transaction_id=excluded.pending_transaction_id,provider_category=excluded.provider_category,provider_category_detailed=excluded.provider_category_detailed,auto_category_key=excluded.auto_category_key,provenance=excluded.provenance,removed_at=NULL,updated_at=now()`,
        [
          t.id,
          t.account_id,
          t.provider_id,
          t.date,
          t.authorized_date,
          t.amount,
          t.currency,
          t.name,
          t.merchant_name,
          t.pending,
          t.pending_transaction_id,
          t.provider_category,
          t.provider_category_detailed,
          t.auto_category_key,
          t.provenance,
        ],
      );
    // A pending row became a posted one: keep what the user entered on the pending row.
    for (const c of changes.carryOver)
      await client.query(
        `UPDATE transactions n SET user_date=o.user_date,category_id=o.category_id,notes=o.notes
         FROM transactions o WHERE n.id=$2 AND o.id=$1
         AND n.user_date IS NULL AND n.category_id IS NULL AND n.notes=''`,
        [c.fromId, c.toId],
      );
    // The parts move too, but only if the amount did not change when the transaction posted.
    for (const c of changes.carryOver)
      await client.query(
        `INSERT INTO transaction_splits(transaction_id,amount,category_id,notes,sort_order,date)
         SELECT n.id,s.amount,s.category_id,s.notes,s.sort_order,s.date
         FROM transaction_splits s JOIN transactions o ON o.id=s.transaction_id JOIN transactions n ON n.id=$2
         WHERE o.id=$1 AND n.amount=o.amount
         AND NOT EXISTS (SELECT 1 FROM transaction_splits x WHERE x.transaction_id=n.id)`,
        [c.fromId, c.toId],
      );
    await applyRulesToSynced(
      client,
      changes.upserts.map((t) => t.id),
    );
    if (changes.removeIds.length)
      await client.query(
        'UPDATE transactions SET removed_at=now(),updated_at=now() WHERE id=ANY($1::text[]) AND removed_at IS NULL',
        [changes.removeIds],
      );
    await client.query('UPDATE connections SET transactions_cursor=$1 WHERE id=$2', [
      cursor,
      connectionId,
    ]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// --- Splits ---
/** Replace all the parts of a transaction's split. */
export async function setSplits(id: string, body: unknown) {
  const b = ensure(splitsBody, body, 'A split needs 2 to 20 parts, each with an amount');
  const parent = await oneTransaction(id);
  assertEditable(parent);
  const problem = splitProblem(parent.amount, b.splits);
  if (problem) throw new Error(problem);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM transaction_splits WHERE transaction_id=$1', [id]);
    for (const [i, part] of b.splits.entries())
      await client.query(
        'INSERT INTO transaction_splits(transaction_id,amount,category_id,notes,sort_order,date) VALUES($1,$2,$3,$4,$5,$6)',
        [id, part.amount, part.category_id, part.notes, i, part.date ?? null],
      );
    await client.query('UPDATE transactions SET updated_at=now() WHERE id=$1', [id]);
    await client.query('COMMIT');
  } catch (e: any) {
    await client.query('ROLLBACK');
    if (e?.code === '23503') throw new Error('Unknown category', { cause: e });
    throw e;
  } finally {
    client.release();
  }
  return oneTransaction(id);
}

export async function removeSplits(id: string) {
  assertEditable(await oneTransaction(id));
  await pool.query('DELETE FROM transaction_splits WHERE transaction_id=$1', [id]);
  return oneTransaction(id);
}

// --- Reading and editing ---
// Effective values: the user's date and category win over the provider's.
const SELECT = `SELECT t.id,t.account_id,a.name AS account_name,a.mask AS account_mask,a.institution,a.included AS account_included,
  coalesce(t.user_date,t.date)::text AS date,t.date::text AS provider_date,t.user_date::text AS user_date,
  t.amount,t.currency,t.name,t.merchant_name,t.pending,t.notes,t.source,
  coalesce(uc.id,rc.id,ac.id,un.id) AS category_id,coalesce(uc.name,rc.name,ac.name,un.name) AS category_name,
  coalesce(uc.emoji,rc.emoji,ac.emoji,un.emoji) AS category_emoji,coalesce(uc.group_name,rc.group_name,ac.group_name,un.group_name) AS category_group,
  t.rule_id,
  CASE WHEN uc.id IS NOT NULL THEN 'user' WHEN rc.id IS NOT NULL THEN 'rule' WHEN ac.id IS NOT NULL AND ac.key<>'uncategorized' THEN 'auto' ELSE 'none' END AS category_source,
  (SELECT coalesce(json_agg(json_build_object('id',s.id,'amount',s.amount::text,'notes',s.notes,'date',s.date::text,'category_id',coalesce(sc.id,un.id),'category_name',coalesce(sc.name,un.name),'category_emoji',coalesce(sc.emoji,un.emoji),'category_group',coalesce(sc.group_name,un.group_name)) ORDER BY s.sort_order,s.id),'[]'::json)
    FROM transaction_splits s LEFT JOIN categories sc ON sc.id=s.category_id WHERE s.transaction_id=t.id) AS splits
  FROM transactions t JOIN accounts a ON a.id=t.account_id
  LEFT JOIN categories uc ON uc.id=t.category_id
  LEFT JOIN categories rc ON rc.id=t.rule_category_id
  LEFT JOIN categories ac ON ac.key=t.auto_category_key
  LEFT JOIN categories un ON un.key='uncategorized'`;
const EFFECTIVE_DATE = 'coalesce(t.user_date,t.date)';
const EFFECTIVE_CATEGORY = 'coalesce(uc.id,rc.id,ac.id,un.id)';

function shape(r: any) {
  const { category_id, category_name, category_emoji, category_group, splits, ...rest } = r;
  return {
    ...rest,
    splits: (splits as any[]).map((p) => ({
      id: Number(p.id),
      amount: p.amount,
      notes: p.notes,
      date: p.date, // null: the same date as the transaction
      category: {
        id: Number(p.category_id),
        name: p.category_name,
        emoji: p.category_emoji,
        group: p.category_group,
      },
    })),
    // Nothing to be out of balance when the transaction is not split.
    split_balanced: splits.length === 0 || splitsBalance(r.amount, splits),
    category: category_id
      ? {
          id: Number(category_id),
          name: category_name,
          emoji: category_emoji,
          group: category_group,
        }
      : null,
  };
}

export async function listTransactions(query: unknown) {
  const q = ensure(transactionQuery, query, 'Invalid transaction filter');
  const where = ['t.removed_at IS NULL'];
  const params: any[] = [];
  const add = (sql: string, value: any) => {
    params.push(value);
    where.push(sql.replace('?', '$' + params.length));
  };
  // A split transaction is in a date range when the transaction or any of its parts is.
  const inRange = (sql: string, value: string) => {
    params.push(value);
    const n = '$' + params.length;
    const part = `EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id AND coalesce(s.date,${EFFECTIVE_DATE}) ${sql} ${n}::date)`;
    where.push(`(${EFFECTIVE_DATE} ${sql} ${n}::date OR ${part})`);
  };
  if (q.from) inRange('>=', q.from);
  if (q.to) inRange('<=', q.to);
  if (q.account) add('t.account_id = ?', q.account);
  if (q.accounts?.length) add('t.account_id = ANY(?::text[])', q.accounts);
  if (q.merchant) add(`lower(${MERCHANT_SQL}) = lower(?)`, q.merchant);
  const categoryIds = [...(q.category ? [q.category] : []), ...(q.categories ?? [])];
  if (categoryIds.length) {
    // A split transaction belongs to every category its parts use; an unsplit one to its own.
    params.push(categoryIds);
    const n = '$' + params.length;
    where.push(
      `((${EFFECTIVE_CATEGORY} = ANY(${n}::bigint[]) AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id))
        OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id AND coalesce(s.category_id,un.id)=ANY(${n}::bigint[])))`,
    );
  }
  if (q.type) {
    // Income or spending as the reports count it: by the category's group type, Uncategorized by direction.
    // Pending transactions are not counted (see LINES_SQL), so they are not listed here either.
    where.push('NOT t.pending');
    params.push(q.type);
    const n = '$' + params.length;
    where.push(
      `((NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id) AND ${lineKindSql(EFFECTIVE_CATEGORY, 't.amount')} = ${n})
        OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id AND ${lineKindSql('coalesce(s.category_id,un.id)', 's.amount')} = ${n}))`,
    );
  }
  if (q.q?.trim()) {
    params.push('%' + q.q.trim().replace(/[\\%_]/g, '\\$&') + '%');
    const n = '$' + params.length;
    where.push(
      `(t.name ILIKE ${n} OR t.merchant_name ILIKE ${n} OR t.notes ILIKE ${n} OR EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id AND s.notes ILIKE ${n}))`,
    );
  }
  // The count a merchant's "View N transactions" link shows ignores paging.
  const unpaged = { where: [...where], params: [...params] };
  if (q.cursor) {
    const [date, id] = Buffer.from(q.cursor, 'base64url').toString().split('|');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !id) throw new Error('Invalid cursor');
    params.push(date, id);
    where.push(`(${EFFECTIVE_DATE}, t.id) < ($${params.length - 1}::date, $${params.length})`);
  }
  params.push(q.limit + 1);
  const rows = (
    await pool.query(
      `${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${EFFECTIVE_DATE} DESC, t.id DESC LIMIT $${params.length}`,
      params,
    )
  ).rows;
  const more = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const total = q.merchant
    ? Number(
        (
          await pool.query(
            `SELECT count(*) AS n FROM transactions t JOIN accounts a ON a.id=t.account_id
             LEFT JOIN categories uc ON uc.id=t.category_id
             LEFT JOIN categories rc ON rc.id=t.rule_category_id
             LEFT JOIN categories ac ON ac.key=t.auto_category_key
             LEFT JOIN categories un ON un.key='uncategorized'
             WHERE ${unpaged.where.join(' AND ')}`,
            unpaged.params,
          )
        ).rows[0].n,
      )
    : undefined;
  return {
    transactions: page.map(shape),
    nextCursor: more && last ? Buffer.from(`${last.date}|${last.id}`).toString('base64url') : null,
    ...(total === undefined ? {} : { total }),
  };
}

/** A pending transaction is replaced when it posts, so it is read-only until then. */
function assertEditable(t: { pending: boolean }) {
  if (t.pending)
    throw Object.assign(new Error('A pending transaction cannot be edited until it posts'), {
      statusCode: 409,
    });
}

async function oneTransaction(id: string) {
  const row = (await pool.query(`${SELECT} WHERE t.id=$1 AND t.removed_at IS NULL`, [id])).rows[0];
  if (!row) throw Object.assign(new Error('Transaction not found'), { statusCode: 404 });
  return shape(row);
}

const MANUAL_ONLY =
  'Only a transaction you added yourself can have its name, amount or account changed';

export async function updateTransaction(id: string, body: unknown) {
  const b = ensure(
    updateTransactionBody,
    body,
    'Check the date, category, notes, name (up to 200 characters) and amount (positive, at most 2 decimals)',
  );
  const current = await oneTransaction(id);
  assertEditable(current);
  const manual = current.source === 'manual';
  const touchesManual =
    b.name !== undefined ||
    b.amount !== undefined ||
    b.direction !== undefined ||
    b.account_id !== undefined;
  if (touchesManual && !manual) throw new Error(MANUAL_ONLY);
  if (typeof b.category_id === 'number') {
    const found = await pool.query('SELECT 1 FROM categories WHERE id=$1', [b.category_id]);
    if (!found.rowCount) throw new Error('Unknown category');
  }
  if (b.account_id !== undefined) {
    const found = await pool.query('SELECT 1 FROM accounts WHERE id=$1', [b.account_id]);
    if (!found.rowCount) throw new Error('Unknown account');
  }
  const sets: string[] = [];
  const params: any[] = [id];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column}=$${params.length}`);
  };
  // A transaction you added has no bank date to fall back to: its date is simply its date.
  if (b.date !== undefined) {
    if (manual) {
      if (b.date === null) throw new Error('A transaction you added needs a date');
      set('date', b.date);
    } else set('user_date', b.date);
  }
  if (b.category_id !== undefined) set('category_id', b.category_id);
  if (b.notes !== undefined) set('notes', b.notes);
  if (b.name !== undefined) {
    set('name', b.name);
    set('merchant_name', b.name);
  }
  if (b.account_id !== undefined) set('account_id', b.account_id);
  if (b.amount !== undefined || b.direction !== undefined) {
    // Money in is negative, like the bank's own sign. Either part can change on its own.
    const direction = b.direction ?? (Number(current.amount) < 0 ? 'in' : 'out');
    const magnitude =
      b.amount !== undefined ? String(b.amount).trim() : String(Math.abs(Number(current.amount)));
    set('amount', (direction === 'in' ? '-' : '') + magnitude);
  }
  await pool.query(
    `UPDATE transactions SET ${sets.join(',')},updated_at=now() WHERE id=$1`,
    params,
  );
  return oneTransaction(id);
}

/** Record a transaction by hand. Money in is stored negative, like the bank's own sign. */
export async function createTransaction(body: unknown) {
  const b = ensure(
    createTransactionBody,
    body,
    'Choose an account and a date, give it a name, and enter a positive amount with at most 2 decimals',
  );
  const account = (await pool.query('SELECT currency FROM accounts WHERE id=$1', [b.account_id]))
    .rows[0];
  if (!account) throw new Error('Unknown account');
  if (typeof b.category_id === 'number') {
    const found = await pool.query('SELECT 1 FROM categories WHERE id=$1', [b.category_id]);
    if (!found.rowCount) throw new Error('Unknown category');
  }
  const id = 'manual:' + crypto.randomUUID();
  await pool.query(
    `INSERT INTO transactions(id,account_id,source,date,amount,currency,name,merchant_name,pending,provenance,category_id,notes)
     VALUES($1,$2,'manual',$3,$4,$5,$6,$6,false,'manual',$7,$8)`,
    [
      id,
      b.account_id,
      b.date,
      (b.direction === 'in' ? '-' : '') + String(b.amount).trim(),
      account.currency === 'UNKNOWN' ? 'USD' : account.currency,
      b.name,
      b.category_id ?? null,
      b.notes ?? '',
    ],
  );
  return oneTransaction(id);
}

/** Only what you added yourself can be deleted; bank and imported transactions are never removed. */
export async function deleteTransaction(id: string) {
  const current = await oneTransaction(id);
  if (current.source !== 'manual')
    throw new Error('Only a transaction you added yourself can be deleted');
  await pool.query('DELETE FROM transactions WHERE id=$1', [id]);
  return { ok: true };
}

/**
 * Recompute every transaction's automatic category from the provider's own fields. Runs at start-up so a
 * change to the mapping reaches rows that were synced earlier. Never touches the user's own choices.
 */
export async function remapAutoCategories() {
  const rows = (
    await pool.query(
      `SELECT id,name,provider_category,provider_category_detailed,auto_category_key FROM transactions WHERE removed_at IS NULL AND source='plaid'`,
    )
  ).rows;
  const changed = rows
    .map((r: any) => ({
      id: r.id,
      key: mapProviderCategory(r.provider_category, r.provider_category_detailed, r.name),
      old: r.auto_category_key,
    }))
    .filter((r) => r.key !== r.old);
  if (!changed.length) return 0;
  await pool.query(
    `UPDATE transactions t SET auto_category_key=x.key,updated_at=now()
     FROM unnest($1::text[],$2::text[]) AS x(id,key) WHERE t.id=x.id`,
    [changed.map((r) => r.id), changed.map((r) => r.key)],
  );
  log.info('transactions.remapped', { count: changed.length });
  return changed.length;
}
