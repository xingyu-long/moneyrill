import { config } from '../lib/config.ts';
import { pool } from './pool.ts';
import type { PoolClient } from 'pg';
export async function recompute(client: PoolClient) {
  await client.query('SELECT pg_advisory_xact_lock(931878)');
  await client.query(`DELETE FROM daily_net_worth`);
  await client.query(`INSERT INTO daily_net_worth(date,assets,liabilities,net_worth,missing_accounts)
 WITH dates AS (SELECT DISTINCT date FROM balance_snapshots), account_values AS (
 SELECT d.date,a.kind,a.currency,b.current_balance FROM dates d CROSS JOIN accounts a
 JOIN LATERAL (SELECT current_balance FROM balance_snapshots b WHERE b.account_id=a.id AND b.date<=d.date ORDER BY date DESC LIMIT 1) b ON true WHERE a.included)
 SELECT date,coalesce(sum(current_balance) FILTER(WHERE kind IN ('cash','investment') AND currency='USD'),0),
 coalesce(sum(current_balance) FILTER(WHERE kind IN ('credit','loan') AND currency='USD'),0),
 coalesce(sum(CASE WHEN kind IN ('credit','loan') THEN -current_balance ELSE current_balance END) FILTER(WHERE currency='USD'),0),
 count(*) FILTER(WHERE current_balance IS NULL OR currency<>'USD') FROM account_values GROUP BY date`);
  // Imported totals stand in until every included account has a live (non-imported) observation;
  // from that day on the live totals above are authoritative.
  await client.query(`INSERT INTO daily_net_worth(date,assets,liabilities,net_worth,missing_accounts)
 SELECT i.date,i.assets,i.liabilities,i.net_worth,0 FROM imported_net_worth i,
 (SELECT coalesce(max(first_live),'infinity'::date) AS day FROM (SELECT min(s.date) AS first_live
  FROM balance_snapshots s JOIN accounts a ON a.id=s.account_id
  WHERE a.included AND s.provenance<>'imported' GROUP BY s.account_id) f) cutover
 WHERE i.date<cutover.day
 ON CONFLICT(date) DO UPDATE SET assets=excluded.assets,liabilities=excluded.liabilities,
 net_worth=excluded.net_worth,missing_accounts=0`);
}
export async function overview() {
  const [
    accounts,
    balances,
    holdings,
    manualHoldings,
    prices,
    benchmarks,
    runs,
    connections,
    netWorth,
  ] = await Promise.all([
    pool.query(
      `SELECT a.*,a.holdings_as_of::text,b.current_balance AS balance,b.holdings_adjustment AS balance_adjustment,b.date::text AS balance_date,b.provenance FROM accounts a LEFT JOIN LATERAL (SELECT * FROM balance_snapshots WHERE account_id=a.id ORDER BY date DESC LIMIT 1)b ON true ORDER BY a.kind,a.name`,
    ),
    pool.query(
      `SELECT account_id,date::text,current_balance,provenance FROM balance_snapshots ORDER BY date`,
    ),
    pool.query(
      `SELECT h.*,h.date::text,s.symbol,s.name,s.asset_class FROM holding_snapshots h JOIN securities s ON s.id=h.security_id ORDER BY h.date`,
    ),
    // Typed in by hand: shown only while the provider has no holdings for the account at its latest date.
    pool.query(
      `SELECT m.account_id,'manual:'||m.id AS security_id,COALESCE(a.holdings_as_of,CURRENT_DATE)::text AS date,m.quantity,m.price,m.quantity*m.price AS value,NULL::numeric AS cost_basis,m.symbol,m.name,m.asset_class,'manual' AS provenance
         FROM manual_holdings m JOIN accounts a ON a.id=m.account_id
         WHERE a.source='manual' OR NOT EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.account_id=a.id AND h.date=COALESCE(a.holdings_as_of,(SELECT max(date) FROM holding_snapshots WHERE account_id=a.id)))`,
    ),
    pool.query(`SELECT symbol,date::text,close FROM security_prices ORDER BY date`),
    pool.query(
      // Only the span the charts can show: from a week before the first balance.
      `SELECT symbol,date::text,level,provenance FROM benchmark_observations WHERE date >= (SELECT min(date) - 7 FROM balance_snapshots) ORDER BY date`,
    ),
    pool.query(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 8`),
    pool.query(
      `SELECT id,institution,products,environment,disconnected_at,last_synced,last_error,consent_expires_at,created_at FROM connections ORDER BY created_at`,
    ),
    // Only when totals were imported from another tracker; otherwise the client derives history itself.
    pool.query(
      `SELECT date::text,net_worth FROM daily_net_worth WHERE EXISTS (SELECT 1 FROM imported_net_worth) ORDER BY date`,
    ),
  ]);
  return {
    accounts: accounts.rows,
    balances: balances.rows,
    holdings: [...holdings.rows, ...manualHoldings.rows],
    prices: prices.rows,
    benchmarks: benchmarks.rows,
    runs: runs.rows,
    connections: connections.rows,
    netWorth: netWorth.rows,
    mode: config.plaidEnv,
    environment: config.appEnv,
    hasSandboxKeys: config.hasKeys,
    hasPlaidKeys: config.hasKeys,
  };
}
