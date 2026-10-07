import { pool } from '../db/pool.ts';
import { log } from '../lib/log.ts';

/** Real benchmarks: ETF prices adjusted for dividends, so the comparison includes reinvested income. */
export const BENCHMARK_SYMBOLS = ['SPY', 'QQQ'];
export const BENCHMARK_PROVENANCE = 'yahoo_adjclose';

type Fetch = typeof fetch;
export type Observation = { date: string; level: number };

/**
 * Parse a Yahoo Finance chart response into daily adjusted closes.
 * Dates are the exchange's local trading day; days without a close are skipped.
 */
export function parseYahooChart(body: any, symbol: string): Observation[] {
  const result = body?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);
  const timestamps: unknown = result.timestamp;
  const adjclose: unknown = result.indicators?.adjclose?.[0]?.adjclose;
  const offset = Number(result.meta?.gmtoffset ?? 0);
  if (!Array.isArray(timestamps) || !Array.isArray(adjclose))
    throw new Error(`Unexpected chart format for ${symbol}`);
  const byDate = new Map<string, number>();
  timestamps.forEach((t, i) => {
    const level = adjclose[i];
    if (typeof t !== 'number' || typeof level !== 'number' || !(level > 0)) return;
    byDate.set(new Date((t + offset) * 1000).toISOString().slice(0, 10), level);
  });
  return [...byDate]
    .map(([date, level]) => ({ date, level }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function fetchYahooHistory(symbol: string, fetchImpl: Fetch = fetch) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d`;
  const r = await fetchImpl(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Yahoo returned HTTP ${r.status} for ${symbol}`);
  const rows = parseYahooChart(await r.json(), symbol);
  if (rows.length < 20) throw new Error(`Too little history for ${symbol}`);
  return rows;
}

/**
 * Replace each symbol's stored history with a fresh download. Adjusted closes are revised
 * back in time after every dividend, so the whole series is rewritten, not appended.
 * A failed download keeps the previous rows.
 */
export async function refreshBenchmarks(fetchImpl: Fetch = fetch) {
  const updated: string[] = [],
    failed: string[] = [];
  for (const symbol of BENCHMARK_SYMBOLS) {
    try {
      const rows = await fetchYahooHistory(symbol, fetchImpl);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM benchmark_observations WHERE symbol=$1', [symbol]);
        await client.query(
          `INSERT INTO benchmark_observations(symbol,date,level,provenance) SELECT $1,date,level,$2 FROM jsonb_to_recordset($3::jsonb) AS x(date date,level numeric)`,
          [symbol, BENCHMARK_PROVENANCE, JSON.stringify(rows)],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      updated.push(symbol);
    } catch (e: any) {
      failed.push(symbol);
      log.warn('benchmarks.refresh_failed', { symbol, code: e.message });
    }
  }
  return { updated, failed };
}
