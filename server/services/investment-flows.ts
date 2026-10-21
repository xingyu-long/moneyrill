import { pool } from '../db/pool.ts';
import { LINES_SQL, lineKindSql } from '../lib/reports.ts';
import { cashFlowsFromBody, ensure } from '../lib/schemas.ts';

export type CashFlowDay = { date: string; amount: string };

const SETTING = 'cash_flows_from';

/**
 * The money the household added to (positive) or took out of (negative) its investments, as a net figure per day,
 * worked out from the same lines the Reports tab uses: income minus spending on the included accounts. Brokerage activity the owner categorised counts in Reports but not here: a dividend paid inside a brokerage is growth, not money added. Transfers
 * (card payments, moves between your own accounts, to or from a brokerage) are left out, pending rows are not
 * counted, and a refund reduces spending. Income and spending both carry the provider sign (positive = money
 * out), so the net flow is the negated sum. Nothing is stored: an edit to a transaction changes the next answer.
 */
export async function cashFlowDays() {
  const flows = (
    await pool.query(
      `WITH lines AS (${LINES_SQL})
       SELECT l.date::text AS date, (-sum(l.amount))::text AS amount
       FROM lines l JOIN accounts a ON a.id=l.account_id AND a.included
       WHERE l.origin='bank' AND ${lineKindSql('l.category_id', 'l.amount')} IN ('income','expense')
       GROUP BY l.date ORDER BY l.date`,
    )
  ).rows as CashFlowDay[];
  // Income lands in the bank accounts, so their transactions are what show the cash flow is being recorded. The
  // automatic start is the first day of the month of the earliest one, so that month's flows are all counted.
  const auto = (
    await pool.query(
      `SELECT date_trunc('month', min(coalesce(t.user_date, t.date)))::date::text AS day
       FROM transactions t JOIN accounts a ON a.id=t.account_id AND a.included AND a.kind='cash'
       WHERE t.removed_at IS NULL AND NOT t.pending AND t.currency='USD'`,
    )
  ).rows[0].day as string | null;
  const override = (await pool.query(`SELECT value FROM settings WHERE key=$1`, [SETTING])).rows[0]
    ?.value as string | undefined;
  return { flows, from: override ?? auto, auto_from: auto, override: override ?? null };
}

/** Choose the day cash flows are counted from, or pass null to go back to the automatic one. */
export async function setCashFlowsFrom(body: unknown) {
  const { date } = ensure(
    cashFlowsFromBody,
    body,
    'Use a real date (YYYY-MM-DD) that is not in the future, or null for the automatic one',
  );
  if (date === null) await pool.query(`DELETE FROM settings WHERE key=$1`, [SETTING]);
  else
    await pool.query(
      `INSERT INTO settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=excluded.value`,
      [SETTING, JSON.stringify(date)],
    );
  return { ok: true };
}
