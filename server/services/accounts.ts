import crypto from 'node:crypto';
import { pool } from '../db/pool.ts';
import { recompute } from '../db/queries.ts';
import { createAccountBody, ensure, manualBalance } from '../lib/schemas.ts';

export async function updateAccount(id: string, b: any) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = (await client.query('SELECT * FROM accounts WHERE id=$1', [id])).rows[0];
    if (!existing) throw new Error('Account not found');
    if (typeof b.included === 'boolean')
      await client.query('UPDATE accounts SET included=$1 WHERE id=$2', [b.included, id]);
    if (b.balance !== undefined) {
      if (existing.source !== 'manual') throw new Error('Only manual balances may be edited');
      ensure(manualBalance, b.balance, 'Balance must be a number');
      await client.query(
        `INSERT INTO balance_snapshots(account_id,date,current_balance,provenance) VALUES($1,CURRENT_DATE,$2,'manual') ON CONFLICT(account_id,date) DO UPDATE SET current_balance=excluded.current_balance,observed_at=now()`,
        [id, b.balance],
      );
      await client.query('UPDATE accounts SET last_synced=now() WHERE id=$1', [id]);
    }
    await recompute(client);
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function createManualAccount(b: any) {
  const account = ensure(createAccountBody, b, 'Enter a name, account type and valid balance');
  const id = crypto.randomUUID(),
    c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO accounts(id,name,institution,kind,currency,source,last_synced) VALUES($1,$2,$3,$4,'USD','manual',now())`,
      [id, account.name.trim(), account.institution || 'Manual account', account.kind],
    );
    await c.query(
      `INSERT INTO balance_snapshots(account_id,date,current_balance,provenance) VALUES($1,CURRENT_DATE,$2,'manual')`,
      [id, account.balance],
    );
    await recompute(c);
    await c.query('COMMIT');
    return { id };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
