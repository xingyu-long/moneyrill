import Decimal from 'decimal.js';
import { pool } from '../db/pool.ts';
import { ensure, reportQuery } from '../lib/schemas.ts';
import {
  fillPeriods,
  LINES_SQL,
  lineKindSql,
  savingsRate,
  shareOf,
  type SeriesRow,
} from '../lib/reports.ts';

type Query = ReturnType<typeof parse>;
const parse = (query: unknown) =>
  ensure(
    reportQuery,
    query,
    'Invalid report filter: use real dates, with the start not after the end',
  );

/**
 * The report lines (see LINES_SQL) with their category, kind and value, filtered by account and category.
 * `value` is positive money for the kind: income = money in, expense = money out (a refund makes it smaller).
 * Transfers are left out. Dates are applied per query, so the breakdown can use a narrower range than the chart.
 */
function base(q: Query) {
  const params: any[] = [];
  const where: string[] = [];
  if (q.accounts?.length) {
    params.push(q.accounts);
    where.push(`l.account_id = ANY($${params.length}::text[])`);
  }
  if (q.categories?.length) {
    params.push(q.categories);
    where.push(`l.category_id = ANY($${params.length}::bigint[])`);
  }
  if (q.merchant) {
    params.push(q.merchant);
    where.push(`lower(l.merchant) = lower($${params.length})`);
  }
  const sql = `WITH lines AS (${LINES_SQL}),
    typed AS (
      SELECT l.txn_id,l.date,l.category_id,l.merchant,c.name,c.emoji,g.name AS group_name,k.kind,
        CASE k.kind WHEN 'income' THEN -l.amount ELSE l.amount END AS value
      FROM lines l
      JOIN categories c ON c.id=l.category_id
      JOIN category_groups g ON g.id=c.group_id
      CROSS JOIN LATERAL (SELECT ${lineKindSql('l.category_id', 'l.amount')} AS kind) k
      WHERE k.kind IN ('income','expense') ${where.map((w) => 'AND ' + w).join(' ')}
    )`;
  return { sql, params };
}

/** Add a date range to a query's parameters; returns the SQL condition. */
function range(params: any[], from?: string, to?: string) {
  const out: string[] = ['true'];
  if (from) {
    params.push(from);
    out.push(`date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    out.push(`date <= $${params.length}::date`);
  }
  return out.join(' AND ');
}

const category = (r: any) => ({
  id: Number(r.category_id),
  name: r.name,
  emoji: r.emoji,
  group: r.group_name,
});

async function totals(q: Query, from?: string, to?: string) {
  const b = base(q);
  const params = [...b.params];
  const r = (
    await pool.query(
      `${b.sql} SELECT
         round(coalesce(sum(value) FILTER (WHERE kind='income'),0),2)::text AS income,
         round(coalesce(sum(value) FILTER (WHERE kind='expense'),0),2)::text AS expenses,
         round(coalesce(sum(value) FILTER (WHERE kind='income'),0) - coalesce(sum(value) FILTER (WHERE kind='expense'),0),2)::text AS net,
         min(date)::text AS first_date, max(date)::text AS last_date
       FROM typed WHERE ${range(params, from, to)}`,
      params,
    )
  ).rows[0];
  return {
    income: r.income as string,
    expenses: r.expenses as string,
    net: r.net as string,
    savings_rate: savingsRate(r.income, r.net),
    first_date: r.first_date as string | null,
    last_date: r.last_date as string | null,
  };
}

async function slices(q: Query, kind: 'income' | 'expense', from?: string, to?: string) {
  const b = base(q);
  const params = [...b.params];
  const rows = (
    await pool.query(
      `${b.sql} SELECT category_id,name,emoji,group_name,round(sum(value),2)::text AS amount
       FROM typed WHERE kind='${kind}' AND ${range(params, from, to)}
       GROUP BY category_id,name,emoji,group_name ORDER BY sum(value) DESC,name`,
      params,
    )
  ).rows;
  const total = rows.reduce((sum: Decimal, r: any) => sum.plus(r.amount), new Decimal(0));
  return rows.map((r: any) => ({
    category: category(r),
    amount: r.amount as string,
    share: shareOf(r.amount, total.toFixed(2)),
  }));
}

/** Income, expenses and net per month, quarter or year, plus what the chosen range is made of. */
export async function cashFlow(query: unknown) {
  const q = parse(query);
  const whole = await totals(q, q.from, q.to);
  const b = base(q);
  const params = [...b.params];
  const bucket = (
    await pool.query(
      `${b.sql} SELECT date_trunc('${q.interval}',date)::date::text AS start,
       round(coalesce(sum(value) FILTER (WHERE kind='income'),0),2)::text AS income,
       round(coalesce(sum(value) FILTER (WHERE kind='expense'),0),2)::text AS expenses,
       round(coalesce(sum(value) FILTER (WHERE kind='income'),0) - coalesce(sum(value) FILTER (WHERE kind='expense'),0),2)::text AS net
     FROM typed WHERE ${range(params, q.from, q.to)} GROUP BY 1 ORDER BY 1`,
      params,
    )
  ).rows as SeriesRow[];
  const from = q.from ?? whole.first_date;
  const lastDay =
    whole.last_date && q.today && q.today > whole.last_date ? q.today : whole.last_date;
  const to = q.to ?? lastDay;
  const series = from && to ? fillPeriods(bucket, from, to, q.interval, !!q.from) : [];
  const bFrom = q.breakdownFrom ?? q.from;
  const bTo = q.breakdownTo ?? q.to;
  const narrowed = bFrom !== q.from || bTo !== q.to;
  const skipped = Number(
    (
      await pool.query(
        "SELECT count(*) AS n FROM transactions WHERE removed_at IS NULL AND currency<>'USD'",
      )
    ).rows[0].n,
  );
  const { first_date, last_date, ...wholeTotals } = whole;
  return {
    range: { from: q.from ?? null, to: q.to ?? null },
    totals: wholeTotals,
    series,
    breakdown: {
      from: bFrom ?? first_date,
      to: bTo ?? last_date,
      totals: narrowed
        ? (({ first_date: _a, last_date: _b, ...t }) => t)(await totals(q, bFrom, bTo))
        : wholeTotals,
      income: await slices(q, 'income', bFrom, bTo),
      expenses: await slices(q, 'expense', bFrom, bTo),
    },
    first_date,
    last_date,
    skipped_non_usd: skipped,
  };
}

/** The donut and summary for one side: spending (expense) or income. */
export async function categoryReport(query: unknown) {
  const q = parse(query);
  const b = base(q);
  const params = [...b.params, q.type];
  const kind = `$${params.length}`;
  const r = (
    await pool.query(
      `${b.sql} SELECT count(DISTINCT txn_id)::int AS count,
         round(coalesce(sum(value),0),2)::text AS total,
         round(coalesce(max(value),0),2)::text AS largest,
         min(date)::text AS first_date, max(date)::text AS last_date
       FROM typed WHERE kind=${kind} AND ${range(params, q.from, q.to)}`,
      params,
    )
  ).rows[0];
  const list = await slices(q, q.type, q.from, q.to);
  return {
    type: q.type,
    total: r.total as string,
    slices: list,
    summary: {
      count: r.count as number,
      largest: r.largest as string,
      average: r.count ? new Decimal(r.total).div(r.count).toFixed(2) : '0.00',
      first_date: r.first_date as string | null,
      last_date: r.last_date as string | null,
    },
  };
}
