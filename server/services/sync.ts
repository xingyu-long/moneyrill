import type { AccountBase } from 'plaid';
import { pool } from '../db/pool.ts';
import { recompute } from '../db/queries.ts';
import { config, assertTokenEnvironment } from '../lib/config.ts';
import { log } from '../lib/log.ts';
import { matchReturnedAccounts } from '../lib/account-match.ts';
import { plaid } from './plaid-client.ts';
import { decrypt } from './token-crypto.ts';
import { saveConnection, updateMetadata } from './connections.ts';
import { refreshBenchmarks } from './benchmarks.ts';
import { applyHoldingPrices, refreshSecurityPrices } from './prices.ts';
import { assetClassOf } from '../lib/investment-transactions.ts';
import { syncInvestmentTransactions } from './investment-transactions.ts';
import { syncTransactions } from './transactions.ts';

const provenance = () => `plaid_${config.plaidEnv}`;

// Accounts the user un-selected in Link are no longer returned: keep their history but drop them from totals.
// Only the first sync that notices changes `included`, so a later manual re-include sticks; it is restored
// automatically if Plaid returns the account again (see the upsert below).
export async function excludeUnreturnedAccounts(
  client: { query: (sql: string, params: any[]) => Promise<unknown> },
  connectionId: string,
  returnedProviderIds: string[],
) {
  await client.query(
    `UPDATE accounts SET included=false,last_error=$1 WHERE connection_id=$2 AND NOT(provider_id=ANY($3::text[])) AND last_error IS DISTINCT FROM $1`,
    ['ACCOUNT_NOT_RETURNED', connectionId, returnedProviderIds],
  );
}

const kindOf = (type: string) =>
  type === 'investment'
    ? 'investment'
    : type === 'credit'
      ? 'credit'
      : type === 'loan'
        ? 'loan'
        : type === 'depository'
          ? 'cash'
          : null;

export async function sandboxSamples() {
  if (config.production)
    throw Object.assign(new Error('Sandbox samples are disabled in production'), {
      statusCode: 403,
    });
  for (const products of [['transactions'], ['investments']]) {
    const exists = await pool.query(
      'SELECT 1 FROM connections WHERE products @> $1::jsonb AND disconnected_at IS NULL',
      [JSON.stringify(products)],
    );
    if (exists.rowCount) continue;
    const p = await plaid.sandboxPublicTokenCreate({
      institution_id: 'ins_109508',
      initial_products: products as any,
    });
    await saveConnection(p.data.public_token, products);
  }
  return syncAll();
}
export async function syncAll() {
  const lock = await pool.connect();
  let got = false;
  try {
    got = (await lock.query('SELECT pg_try_advisory_lock(931877) AS ok')).rows[0].ok;
    if (!got) return { status: 'busy', message: 'A sync is already running' };
    const run = (await pool.query("INSERT INTO sync_runs(status) VALUES('running') RETURNING id"))
      .rows[0].id;
    const connections = (
      await pool.query(
        'SELECT * FROM connections WHERE environment=$1 AND disconnected_at IS NULL',
        [config.plaidEnv],
      )
    ).rows;
    let succeeded = 0;
    const failures: string[] = [];
    for (const c of connections) {
      try {
        const access_token = decrypt(c.token);
        assertTokenEnvironment(access_token, 'access');
        let accounts: Pick<AccountBase, 'account_id' | 'type' | 'name' | 'balances' | 'mask'>[] = (
          await plaid.accountsGet({ access_token })
        ).data.accounts;
        const h =
          c.products.includes('investments') && accounts.some((a) => a.type === 'investment')
            ? (await plaid.investmentsHoldingsGet({ access_token })).data
            : null;
        if (h) accounts = h.accounts;
        const rematchedAccounts = new Map<string, string>(),
          today = new Date().toISOString().slice(0, 10),
          client = await pool.connect();
        try {
          await client.query('BEGIN');
          // An account removed and added back in Link comes back with a new Plaid id: keep the saved account.
          const saved = (
            await client.query(
              'SELECT id,provider_id,name,mask,kind,currency,last_synced FROM accounts WHERE connection_id=$1',
              [c.id],
            )
          ).rows;
          const localId = new Map<string, string>(saved.map((r: any) => [r.provider_id, r.id]));
          const returned = accounts.flatMap((a) => {
            const kind = kindOf(a.type);
            return kind
              ? [
                  {
                    account_id: a.account_id,
                    name: a.name,
                    mask: a.mask ?? null,
                    kind,
                    currency: a.balances.iso_currency_code || 'UNKNOWN',
                  },
                ]
              : [];
          });
          for (const [providerId, id] of matchReturnedAccounts(saved, returned)) {
            await client.query('UPDATE accounts SET provider_id=$1 WHERE id=$2', [providerId, id]);
            localId.set(providerId, id);
            const before = saved.find((r: any) => r.id === id)?.last_synced;
            if (before) rematchedAccounts.set(id, new Date(before).toISOString().slice(0, 10));
            log.info('sync.account_rematched', { connection: c.id });
          }
          const idOf = (providerId: string) => localId.get(providerId) || c.id + ':' + providerId;
          for (const a of accounts) {
            const kind = kindOf(a.type);
            if (!kind) continue;
            const id = idOf(a.account_id);
            await client.query(
              `INSERT INTO accounts(id,connection_id,provider_id,name,institution,kind,currency,mask,source,last_synced,provider_as_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10) ON CONFLICT(id) DO UPDATE SET name=excluded.name,currency=excluded.currency,provider_as_of=excluded.provider_as_of,last_synced=now(),included=CASE WHEN accounts.last_error='ACCOUNT_NOT_RETURNED' THEN true ELSE accounts.included END,last_error=NULL`,
              [
                id,
                c.id,
                a.account_id,
                a.name,
                c.institution,
                kind,
                a.balances.iso_currency_code || 'UNKNOWN',
                a.mask,
                provenance(),
                a.balances.last_updated_datetime || null,
              ],
            );
            await client.query(
              `INSERT INTO balance_snapshots(account_id,date,current_balance,provenance) VALUES($1,$2,$3,$4) ON CONFLICT(account_id,date) DO UPDATE SET current_balance=excluded.current_balance,holdings_adjustment=0,observed_at=now()`,
              [id, today, a.balances.current, provenance()],
            );
          }
          if (h) {
            for (const s of h.securities)
              await client.query(
                `INSERT INTO securities(id,symbol,name,asset_class) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,symbol=excluded.symbol`,
                [
                  c.id + ':' + s.security_id,
                  s.ticker_symbol,
                  s.name || 'Unnamed security',
                  assetClassOf(s),
                ],
              );
            for (const a of accounts.filter((a) => a.type === 'investment')) {
              await client.query('DELETE FROM holding_snapshots WHERE account_id=$1 AND date=$2', [
                idOf(a.account_id),
                today,
              ]);
              await client.query('UPDATE accounts SET holdings_as_of=$1 WHERE id=$2', [
                today,
                idOf(a.account_id),
              ]);
            }
            for (const x of h.holdings)
              await client.query(
                `INSERT INTO holding_snapshots(account_id,security_id,date,quantity,price,value,cost_basis,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(account_id,security_id,date) DO UPDATE SET quantity=excluded.quantity,price=excluded.price,value=excluded.value,cost_basis=excluded.cost_basis`,
                [
                  idOf(x.account_id),
                  c.id + ':' + x.security_id,
                  today,
                  x.quantity,
                  x.institution_price,
                  x.institution_value,
                  x.cost_basis,
                  provenance(),
                ],
              );
          }
          await excludeUnreturnedAccounts(
            client,
            c.id,
            accounts.map((a) => a.account_id),
          );
          await client.query(
            'UPDATE connections SET last_synced=now(),last_error=NULL WHERE id=$1',
            [c.id],
          );
          await recompute(client);
          await client.query('COMMIT');
          succeeded++;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
        // Best effort and separate: a transactions problem must never undo or fail the balances.
        const transactionsError = await syncTransactions(c, access_token, rematchedAccounts);
        if (transactionsError) failures.push(transactionsError);
        const activityError = await syncInvestmentTransactions(c, access_token);
        if (activityError) failures.push(activityError);
        try {
          await updateMetadata(c.id, access_token);
        } catch {
          // best effort: the connection is already saved
        }
      } catch (e: any) {
        const code = e.response?.data?.error_code || 'SYNC_FAILED';
        failures.push(code);
        log.warn('sync.connection_failed', { connection: c.id, institution: c.institution, code });
        await pool.query('UPDATE accounts SET last_error=$1 WHERE connection_id=$2', [code, c.id]);
        await pool.query('UPDATE connections SET last_error=$1 WHERE id=$2', [code, c.id]);
      }
    }
    if (config.marketData) {
      // Market data is best effort: a failed download keeps the stored history.
      const bench = await refreshBenchmarks();
      if (bench.failed.length) failures.push('BENCHMARKS_FAILED');
      // Ticker prices are best effort too, and a ticker Yahoo does not know is not a failed sync.
      await refreshSecurityPrices();
      // Value the holdings at those closes (today's balance of real investment accounts), whatever the download did.
      await applyHoldingPrices();
    }
    const status = failures.length ? 'partial' : connections.length ? 'success' : 'idle';
    const message = `${succeeded} connections updated${failures.length ? '; ' + failures.join(', ') : ''}`;
    await pool.query('UPDATE sync_runs SET status=$1,message=$2,finished_at=now() WHERE id=$3', [
      status,
      message,
      run,
    ]);
    return { status, message };
  } finally {
    if (got) await lock.query('SELECT pg_advisory_unlock(931877)');
    lock.release();
  }
}
