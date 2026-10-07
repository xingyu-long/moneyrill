import { pool } from '../db/pool.ts';
import { ensure, manualHoldingsBody } from '../lib/schemas.ts';

type Queryable = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

/** Holdings can be typed in for an investment account the provider gives no holdings for: a manual one, or a synced one whose latest holdings are empty. */
export async function holdingsEditable(db: Queryable, account: any) {
  if (account.kind !== 'investment') return false;
  if (account.source === 'manual') return true;
  const synced = await db.query(
    `SELECT 1 FROM holding_snapshots WHERE account_id=$1
       AND date=COALESCE($2::date,(SELECT max(date) FROM holding_snapshots WHERE account_id=$1)) LIMIT 1`,
    [account.id, account.holdings_as_of],
  );
  return synced.rows.length === 0;
}

export async function setManualHoldings(accountId: string, body: unknown) {
  const b = ensure(
    manualHoldingsBody,
    body,
    'Each holding needs a name, a type, a quantity above zero and a price',
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = (
      await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE', [accountId])
    ).rows[0];
    if (!account) throw new Error('Account not found');
    if (!(await holdingsEditable(client, account)))
      throw new Error('Holdings can only be entered for an account the provider gives none for');
    await client.query('DELETE FROM manual_holdings WHERE account_id=$1', [accountId]);
    for (const h of b.holdings)
      await client.query(
        'INSERT INTO manual_holdings(account_id,symbol,name,asset_class,quantity,price) VALUES($1,$2,$3,$4,$5,$6)',
        [accountId, h.symbol, h.name, h.asset_class, String(h.quantity), String(h.price)],
      );
    await client.query('COMMIT');
    return { ok: true, count: b.holdings.length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
