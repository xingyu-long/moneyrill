// Pure logic for the Reports tab: periods, savings rate and the SQL that decides what counts as income or spending.
import Decimal from 'decimal.js';

export type Interval = 'day' | 'month' | 'quarter' | 'year';
export type LineKind = 'income' | 'expense';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const parts = (v: string) => ({ y: +v.slice(0, 4), m: +v.slice(5, 7), d: +v.slice(8, 10) });
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

const shiftDay = (v: string, by: number) => {
  const { y, m, d } = parts(v);
  return new Date(Date.UTC(y, m - 1, d + by)).toISOString().slice(0, 10);
};

/** First day of the day, month, quarter or year that contains `date`. */
export function periodStart(date: string, interval: Interval) {
  if (interval === 'day') return date;
  const { y, m } = parts(date);
  if (interval === 'year') return iso(y, 1, 1);
  if (interval === 'quarter') return iso(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
  return iso(y, m, 1);
}

/** Last day (inclusive) of the period that starts on `start`. */
export function periodEnd(start: string, interval: Interval) {
  if (interval === 'day') return start;
  const { y, m } = parts(start);
  const endMonth = interval === 'year' ? 12 : interval === 'quarter' ? m + 2 : m;
  return iso(y, endMonth, lastDay(y, endMonth));
}

/** First day of the period after the one starting on `start`. */
export function nextPeriod(start: string, interval: Interval) {
  if (interval === 'day') return shiftDay(start, 1);
  const { y, m } = parts(start);
  const total = y * 12 + (m - 1) + (interval === 'year' ? 12 : interval === 'quarter' ? 3 : 1);
  return iso(Math.floor(total / 12), (total % 12) + 1, 1);
}

export type SeriesRow = { start: string; income: string; expenses: string; net: string };
export type Period = SeriesRow & { end: string; partial: boolean };

export const MAX_PERIODS = 600;

/**
 * Every period from `from` to `to` (inclusive), with zeros where nothing happened. A period is partial when the
 * range ends before it does, or, when the owner picked the start, when the range starts after it begins.
 */
export function fillPeriods(
  rows: SeriesRow[],
  from: string,
  to: string,
  interval: Interval,
  explicitFrom: boolean,
): Period[] {
  const byStart = new Map(rows.map((r) => [r.start, r]));
  const out: Period[] = [];
  for (let s = periodStart(from, interval); s <= to; s = nextPeriod(s, interval)) {
    const end = periodEnd(s, interval);
    const r = byStart.get(s);
    out.push({
      start: s,
      end,
      income: r?.income ?? '0.00',
      expenses: r?.expenses ?? '0.00',
      net: r?.net ?? '0.00',
      partial: end > to || (explicitFrom && s < from),
    });
  }
  return out.slice(-MAX_PERIODS);
}

/** Net as a percentage of income, one decimal; null when there was no income to save from. */
export function savingsRate(income: string | number, net: string | number) {
  const i = new Decimal(income);
  if (i.lte(0)) return null;
  return new Decimal(net).div(i).times(100).toDecimalPlaces(1).toNumber();
}

/** A share of the total in percent, one decimal; 0 when the total is not positive. */
export function shareOf(amount: string | number, total: string | number) {
  const t = new Decimal(total);
  return t.lte(0) ? 0 : new Decimal(amount).div(t).times(100).toDecimalPlaces(1).toNumber();
}

/**
 * SQL for the kind of one line (a whole transaction, or one part of a split): the type of its category's group,
 * except Uncategorized, which counts by direction (money in = income, money out = expense). Transfers stay transfers.
 * `categoryId` and `amount` are SQL expressions; amounts use the provider sign (positive = money out).
 */
export const lineKindSql = (categoryId: string, amount: string) =>
  `(SELECT CASE WHEN c.key='uncategorized' THEN CASE WHEN ${amount}<0 THEN 'income' ELSE 'expense' END ELSE g.type END
    FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE c.id=${categoryId})`;

/** The name shown for a transaction's merchant: the merchant if the bank gave one, else the statement text. */
export const MERCHANT_SQL = "coalesce(nullif(t.merchant_name,''),t.name)";

/**
 * Every report line: unsplit transactions as they are, split transactions as their parts (own date, own category).
 * Pending transactions are left out until they post: they can still change or disappear, and Monarch skips them too.
 * Brokerage activity is a line only once the owner gave it a category (`origin` is `investment`, otherwise `bank`);
 * an uncategorised buy, deposit or share move counts nowhere, so nothing is counted twice.
 */
export const LINES_SQL = `SELECT t.id AS txn_id,t.account_id,coalesce(t.user_date,t.date) AS date,t.amount,coalesce(uc.id,rc.id,ac.id,un.id) AS category_id,${MERCHANT_SQL} AS merchant,'bank' AS origin
  FROM transactions t
  LEFT JOIN categories uc ON uc.id=t.category_id
  LEFT JOIN categories rc ON rc.id=t.rule_category_id
  LEFT JOIN categories ac ON ac.key=t.auto_category_key
  LEFT JOIN categories un ON un.key='uncategorized'
  WHERE t.removed_at IS NULL AND t.currency='USD' AND NOT t.pending
  AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id)
  UNION ALL
  SELECT t.id,t.account_id,coalesce(s.date,t.user_date,t.date),s.amount,coalesce(s.category_id,un.id),${MERCHANT_SQL},'bank'
  FROM transaction_splits s
  JOIN transactions t ON t.id=s.transaction_id AND t.removed_at IS NULL AND t.currency='USD' AND NOT t.pending
  LEFT JOIN categories un ON un.key='uncategorized'
  UNION ALL
  SELECT i.id,i.account_id,i.date,i.amount,i.category_id,i.name,'investment'
  FROM investment_transactions i
  WHERE i.removed_at IS NULL AND i.currency='USD' AND i.category_id IS NOT NULL`;
