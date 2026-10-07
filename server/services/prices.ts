import { pool } from '../db/pool.ts';
import { recompute } from '../db/queries.ts';
import { log } from '../lib/log.ts';
import { parseYahooCloses, yahooSymbol } from '../lib/prices.ts';

type Fetch = typeof fetch;
const MAX_SYMBOLS = 200;
const DAY = 86400;

export async function fetchYahooCloses(symbol: string, fromUnix: number, fetchImpl: Fetch = fetch) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${fromUnix}&period2=${Math.floor(Date.now() / 1000) + DAY}&interval=1d`;
  const r = await fetchImpl(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Yahoo returned HTTP ${r.status} for ${symbol}`);
  const rows = parseYahooCloses(await r.json(), symbol);
  if (!rows.length) throw new Error(`No closes for ${symbol}`);
  return rows;
}

/** Tickers held in a real account (recent holdings, or typed in by hand). The demo data is never priced from the market. */
export async function heldSymbols() {
  const rows = (
    await pool.query(
      `SELECT s.symbol FROM holding_snapshots h
         JOIN securities s ON s.id=h.security_id JOIN accounts a ON a.id=h.account_id
         WHERE h.date >= CURRENT_DATE - 14 AND a.source <> 'simulated'
       UNION
       SELECT m.symbol FROM manual_holdings m JOIN accounts a ON a.id=m.account_id WHERE a.source <> 'simulated'`,
    )
  ).rows;
  return [
    ...new Set<string>(
      rows
        .map((r: any) =>
          String(r.symbol || '')
            .trim()
            .toUpperCase(),
        )
        .filter(Boolean),
    ),
  ]
    .filter((s) => yahooSymbol(s))
    .sort()
    .slice(0, MAX_SYMBOLS);
}

/**
 * Download each held ticker's closes since a week before the first balance and replace what is stored from
 * that day. A ticker Yahoo does not know, or a failed download, keeps its stored rows and never fails the
 * sync: the holding then shows the price the bank (or you) supplied.
 */
export async function refreshSecurityPrices(fetchImpl: Fetch = fetch) {
  const updated: string[] = [],
    failed: string[] = [];
  const first = (await pool.query('SELECT min(date)::text AS d FROM balance_snapshots')).rows[0]?.d;
  const from = first ? new Date(first + 'T00:00:00Z') : new Date(Date.now() - 365 * DAY * 1000);
  from.setUTCDate(from.getUTCDate() - 7);
  const fromDate = from.toISOString().slice(0, 10);
  for (const held of await heldSymbols()) {
    try {
      const rows = await fetchYahooCloses(
        yahooSymbol(held)!,
        Math.floor(from.getTime() / 1000),
        fetchImpl,
      );
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM security_prices WHERE symbol=$1 AND date >= $2', [
          held,
          fromDate,
        ]);
        await client.query(
          `INSERT INTO security_prices(symbol,date,close) SELECT $1,date,close FROM jsonb_to_recordset($2::jsonb) AS x(date date,close numeric) ON CONFLICT DO NOTHING`,
          [held, JSON.stringify(rows.filter((r) => r.date >= fromDate))],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      updated.push(held);
    } catch (e: any) {
      failed.push(held);
      log.warn('prices.refresh_failed', { symbol: held, code: e.message });
    }
  }
  return { updated, failed };
}

/**
 * Today's balance of each real investment account, with its holdings valued at the latest closes: the bank's
 * balance + shares x (close - the bank's price) for every holding that has a recent close. Cash and anything the
 * bank counts outside the listed holdings stay as the bank reports. A close more than 2x or less than half the
 * bank's price (a split the bank has not caught up with, a wrong symbol) is ignored, and so is one older than a
 * week. Starting from the bank's own balance each time (current_balance - holdings_adjustment) makes it safe to run
 * again. Returns the number of accounts adjusted.
 */
export async function applyHoldingPrices() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `WITH adj AS (
         SELECT h.account_id, SUM(h.quantity*(p.close - h.price)) AS delta
         FROM accounts a
         JOIN holding_snapshots h ON h.account_id=a.id AND h.date=a.holdings_as_of
         JOIN securities s ON s.id=h.security_id
         JOIN LATERAL (SELECT close FROM security_prices
                       WHERE symbol=upper(trim(s.symbol)) AND date BETWEEN CURRENT_DATE-7 AND CURRENT_DATE
                       ORDER BY date DESC LIMIT 1) p ON true
         WHERE a.source='plaid_production' AND a.kind='investment' AND a.currency='USD'
           AND h.quantity IS NOT NULL AND h.price > 0 AND p.close BETWEEN h.price*0.5 AND h.price*2
         GROUP BY h.account_id)
       UPDATE balance_snapshots b
       SET current_balance = b.current_balance - b.holdings_adjustment + adj.delta, holdings_adjustment = adj.delta
       FROM adj WHERE b.account_id=adj.account_id AND b.date=CURRENT_DATE AND b.current_balance IS NOT NULL
       RETURNING b.account_id`,
    );
    if (r.rowCount) await recompute(client);
    await client.query('COMMIT');
    if (r.rowCount) log.info('prices.holdings_applied', { accounts: r.rowCount });
    return r.rowCount ?? 0;
  } catch (e: any) {
    await client.query('ROLLBACK');
    log.warn('prices.holdings_apply_failed', { code: e.message });
    return 0;
  } finally {
    client.release();
  }
}
