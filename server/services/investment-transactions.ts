import { pool } from '../db/pool.ts';
import { config } from '../lib/config.ts';
import { log } from '../lib/log.ts';
import {
  planInvestmentChanges,
  type InvestmentChanges,
  type InvestmentPage,
} from '../lib/investment-transactions.ts';
import { QUIET_TRANSACTION_ERRORS } from '../lib/transactions.ts';
import { lineKindSql } from '../lib/reports.ts';
import { ensure, updateInvestmentBody } from '../lib/schemas.ts';
import { plaid } from './plaid-client.ts';
import { applyRulesToSynced } from './rules.ts';

const FIRST_DAYS = 730; // Plaid's longest history
const LATER_DAYS = 30;
const PAGE = 500;

const day = (offsetDays: number) =>
  new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);

/**
 * Pull brokerage activity for one Item. Plaid has no cursor for it, so this reads a window of dates: two years the
 * first time, the last 30 days afterwards. Runs after the balances and the bank transactions are saved, in its own
 * database transaction: a failure here never touches either. Returns an error code, or null.
 */
export async function syncInvestmentTransactions(
  connection: { id: string; products: string[] },
  access_token: string,
) {
  if (!connection.products.includes('investments')) return null;
  const accounts = new Map<string, string>(
    (
      await pool.query(
        `SELECT id, provider_id FROM accounts WHERE connection_id=$1 AND kind='investment'`,
        [connection.id],
      )
    ).rows.map((r: any) => [r.provider_id, r.id]),
  );
  if (!accounts.size) return null;
  try {
    const first =
      (
        await pool.query('SELECT investments_backfilled_at FROM connections WHERE id=$1', [
          connection.id,
        ])
      ).rows[0]?.investments_backfilled_at == null;
    const window = { from: day(first ? FIRST_DAYS : LATER_DAYS), to: day(0), complete: false };
    const pages: InvestmentPage[] = [];
    for (let offset = 0; ;) {
      const r = (
        await plaid.investmentsTransactionsGet({
          access_token,
          start_date: window.from,
          end_date: window.to,
          options: { count: PAGE, offset },
        })
      ).data;
      pages.push({ transactions: r.investment_transactions, securities: r.securities });
      offset += r.investment_transactions.length;
      if (!r.investment_transactions.length || offset >= r.total_investment_transactions) break;
    }
    window.complete = true;
    const saved = (
      await pool.query(
        `SELECT id, date::text AS date FROM investment_transactions
         WHERE account_id=ANY($1::text[]) AND removed_at IS NULL`,
        [[...accounts.values()]],
      )
    ).rows;
    const changes = planInvestmentChanges(
      connection.id,
      pages,
      accounts,
      `plaid_${config.plaidEnv}`,
      window,
      saved,
    );
    await applyInvestmentChanges(connection.id, changes, first);
    log.info('sync.investment_transactions', {
      connection: connection.id,
      added: changes.upserts.length,
      removed: changes.removeIds.length,
      skipped: changes.skipped,
    });
    return null;
  } catch (e: any) {
    const code = e.response?.data?.error_code || 'SYNC_FAILED';
    if (QUIET_TRANSACTION_ERRORS.includes(code)) {
      log.info('sync.investment_transactions_skipped', { connection: connection.id, code });
      return null;
    }
    log.warn('sync.investment_transactions_failed', { connection: connection.id, code });
    return 'INVESTMENTS_' + code;
  }
}

/** Save one sync's brokerage activity together. Provider columns only: your category and notes are never touched. */
export async function applyInvestmentChanges(
  connectionId: string,
  changes: InvestmentChanges,
  markBackfilled: boolean,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of changes.securities)
      await client.query(
        `INSERT INTO securities(id,symbol,name,asset_class) VALUES($1,$2,$3,$4)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,symbol=excluded.symbol`,
        [s.id, s.symbol, s.name, s.asset_class],
      );
    for (const t of changes.upserts)
      await client.query(
        `INSERT INTO investment_transactions(id,account_id,provider_id,security_id,date,name,type,subtype,amount,quantity,price,fees,currency,cancel_transaction_id,provenance)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,security_id=excluded.security_id,date=excluded.date,name=excluded.name,type=excluded.type,subtype=excluded.subtype,amount=excluded.amount,quantity=excluded.quantity,price=excluded.price,fees=excluded.fees,currency=excluded.currency,cancel_transaction_id=excluded.cancel_transaction_id,provenance=excluded.provenance,removed_at=NULL,updated_at=now()`,
        [
          t.id,
          t.account_id,
          t.provider_id,
          t.security_id,
          t.date,
          t.name,
          t.type,
          t.subtype,
          t.amount,
          t.quantity,
          t.price,
          t.fees,
          t.currency,
          t.cancel_transaction_id,
          t.provenance,
        ],
      );
    if (changes.removeIds.length)
      await client.query(
        'UPDATE investment_transactions SET removed_at=now(),updated_at=now() WHERE id=ANY($1::text[]) AND removed_at IS NULL',
        [changes.removeIds],
      );
    if (markBackfilled)
      await client.query('UPDATE connections SET investments_backfilled_at=now() WHERE id=$1', [
        connectionId,
      ]);
    await applyRulesToSynced(
      client,
      changes.upserts.map((t) => t.id),
      'investment',
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// --- Reading and editing (the Transactions list shows brokerage activity next to bank and card rows) ---

const SELECT = `SELECT i.id,i.account_id,a.name AS account_name,a.mask AS account_mask,a.institution,a.included AS account_included,a.kind AS account_kind,
  i.date::text AS date,i.amount::text AS amount,i.currency,i.name,i.notes,i.type,i.subtype,
  trim_scale(i.quantity)::text AS quantity,trim_scale(i.price)::text AS price,trim_scale(i.fees)::text AS fees,
  c.id AS category_id,i.category_id AS user_category_id,i.rule_id,c.name AS category_name,c.emoji AS category_emoji,c.group_name AS category_group,
  s.symbol AS security_symbol,s.name AS security_name
  FROM investment_transactions i JOIN accounts a ON a.id=i.account_id
  LEFT JOIN categories c ON c.id=coalesce(i.category_id,i.rule_category_id)
  LEFT JOIN securities s ON s.id=i.security_id`;

/** The same shape as a bank or card row, plus `activity` and `investment`. */
function shape(r: any) {
  return {
    id: r.id,
    account_id: r.account_id,
    account_name: r.account_name,
    account_mask: r.account_mask,
    institution: r.institution,
    account_included: r.account_included,
    account_kind: r.account_kind,
    date: r.date,
    provider_date: r.date,
    user_date: null,
    amount: r.amount,
    currency: r.currency,
    name: r.name,
    merchant_name: null,
    pending: false,
    notes: r.notes,
    source: 'plaid',
    category: r.category_id
      ? {
          id: Number(r.category_id),
          name: r.category_name,
          emoji: r.category_emoji,
          group: r.category_group,
        }
      : null,
    category_source: r.user_category_id ? 'user' : r.category_id ? 'rule' : 'none',
    rule_id: r.rule_id === null ? null : Number(r.rule_id),
    splits: [],
    split_balanced: true,
    activity: 'investment' as const,
    investment: {
      type: r.type,
      subtype: r.subtype,
      quantity: r.quantity,
      price: r.price,
      fees: r.fees,
      security:
        r.security_symbol || r.security_name
          ? { symbol: r.security_symbol, name: r.security_name }
          : null,
    },
  };
}

export type ActivityFilter = {
  from?: string;
  to?: string;
  account?: string;
  accounts?: string[];
  categories: number[];
  type?: 'income' | 'expense';
  q?: string;
  cursor?: { date: string; id: string };
  limit: number;
};

/**
 * Brokerage rows for the Transactions list, newest first, `limit` of them. Each filter keeps its meaning: categories and
 * `type` match only rows the owner categorised (the way Reports counts them).
 */
export async function listActivity(f: ActivityFilter) {
  const where = ['i.removed_at IS NULL'];
  const params: any[] = [];
  const add = (sql: string, value: any) => {
    params.push(value);
    where.push(sql.replaceAll('?', '$' + params.length));
  };
  if (f.from) add('i.date >= ?::date', f.from);
  if (f.to) add('i.date <= ?::date', f.to);
  if (f.account) add('i.account_id = ?', f.account);
  if (f.accounts?.length) add('i.account_id = ANY(?::text[])', f.accounts);
  // Your category, else a rule's: the one the row counts under.
  const category = 'coalesce(i.category_id,i.rule_category_id)';
  if (f.categories.length) add(`${category} = ANY(?::bigint[])`, f.categories);
  if (f.type)
    add(
      `${category} IS NOT NULL AND i.currency='USD' AND ${lineKindSql(category, 'i.amount')} = ?`,
      f.type,
    );
  if (f.q?.trim())
    add(
      '(i.name ILIKE ? OR i.notes ILIKE ? OR s.symbol ILIKE ? OR s.name ILIKE ?)',
      '%' + f.q.trim().replace(/[\\%_]/g, '\\$&') + '%',
    );
  if (f.cursor) {
    params.push(f.cursor.date, f.cursor.id);
    where.push(`(i.date, i.id) < ($${params.length - 1}::date, $${params.length})`);
  }
  params.push(f.limit);
  const rows = (
    await pool.query(
      `${SELECT} WHERE ${where.join(' AND ')} ORDER BY i.date DESC, i.id DESC LIMIT $${params.length}`,
      params,
    )
  ).rows;
  return rows.map(shape);
}

export async function oneActivity(id: string) {
  const row = (await pool.query(`${SELECT} WHERE i.id=$1 AND i.removed_at IS NULL`, [id])).rows[0];
  return row ? shape(row) : null;
}

const CATEGORY_AND_NOTES = 'Only the category and notes of investment activity can be changed';

/** Brokerage activity: the owner can give it a category (then it counts in Reports) and notes; nothing else. */
export async function updateActivity(id: string, body: unknown) {
  const keys = body && typeof body === 'object' ? Object.keys(body) : [];
  if (keys.some((k) => k !== 'category_id' && k !== 'notes'))
    throw Object.assign(new Error(CATEGORY_AND_NOTES), { statusCode: 409 });
  const b = ensure(updateInvestmentBody, body, 'Check the category and notes');
  if (typeof b.category_id === 'number') {
    const found = await pool.query('SELECT 1 FROM categories WHERE id=$1', [b.category_id]);
    if (!found.rowCount) throw new Error('Unknown category');
  }
  const sets: string[] = [];
  const params: any[] = [id];
  if (b.category_id !== undefined) {
    params.push(b.category_id);
    sets.push(`category_id=$${params.length}`);
  }
  if (b.notes !== undefined) {
    params.push(b.notes);
    sets.push(`notes=$${params.length}`);
  }
  await pool.query(
    `UPDATE investment_transactions SET ${sets.join(',')},updated_at=now() WHERE id=$1`,
    params,
  );
  return oneActivity(id);
}

export const activityLocked = () =>
  Object.assign(new Error(CATEGORY_AND_NOTES), { statusCode: 409 });
