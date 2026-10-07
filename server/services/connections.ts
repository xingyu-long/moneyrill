import { pool } from '../db/pool.ts';
import { config, assertTokenEnvironment } from '../lib/config.ts';
import { log } from '../lib/log.ts';
import {
  accountLinkProducts,
  requestedAccountProducts,
  reconnectLinkOptions,
  productsForAccounts,
} from '../lib/link-products.ts';
import { plaid } from './plaid-client.ts';
import { encrypt, decrypt } from './token-crypto.ts';

export async function storeExistingConnection(
  accessToken: string,
  expectedId?: string,
  products?: string[],
) {
  assertTokenEnvironment(accessToken, 'access');
  const item = (await plaid.itemGet({ access_token: accessToken })).data.item;
  if (expectedId && item.item_id !== expectedId) throw new Error('Item identity mismatch');
  const supported =
    products ||
    ((item.billed_products || []).some((product) => String(product) === 'investments')
      ? ['investments']
      : ['transactions']);
  await storeToken(item.item_id, accessToken, supported);
  await updateMetadata(item.item_id, accessToken, item);
  return item.item_id;
}
export async function storeToken(id: string, accessToken: string, products: string[]) {
  await pool.query(
    `INSERT INTO connections(id,institution,token,products,environment) VALUES($1,'Connected institution',$2,$3,$4) ON CONFLICT(id) DO UPDATE SET token=excluded.token,disconnected_at=NULL`,
    [id, encrypt(accessToken), JSON.stringify(products), config.plaidEnv],
  );
}
export async function updateMetadata(id: string, access_token: string, item?: any) {
  item = item || (await plaid.itemGet({ access_token })).data.item;
  let name: string | undefined;
  if (item.institution_id)
    try {
      name = (
        await plaid.institutionsGetById({
          institution_id: item.institution_id,
          country_codes: ['US'] as any,
        })
      ).data.institution.name;
    } catch {
      // best effort: the connection is already saved
    }
  await pool.query(
    'UPDATE connections SET institution=coalesce($1,institution),consent_expires_at=$2 WHERE id=$3',
    [name || null, item.consent_expiration_time || null, id],
  );
}
export async function saveConnection(publicToken: string, products: string[]) {
  assertTokenEnvironment(publicToken, 'public');
  const { data } = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  // Persist immediately: a later metadata failure must not lose an exchanged token.
  await storeToken(data.item_id, data.access_token, products);
  try {
    const accounts = (await plaid.accountsGet({ access_token: data.access_token })).data.accounts;
    await pool.query('UPDATE connections SET products=$1 WHERE id=$2', [
      JSON.stringify(productsForAccounts(products, accounts)),
      data.item_id,
    ]);
    await updateMetadata(data.item_id, data.access_token);
  } catch {
    // best effort: the connection is already saved
  }
  return data.item_id;
}
async function activeConnection(id: string) {
  const c = (
    await pool.query(
      'SELECT * FROM connections WHERE id=$1 AND environment=$2 AND disconnected_at IS NULL',
      [id, config.plaidEnv],
    )
  ).rows[0];
  if (!c) throw new Error('Active connection not found');
  return c;
}
export async function createLink(connectionId?: string) {
  const products = requestedAccountProducts;
  const params: any = {
    client_name: 'Moneyrill',
    user: { client_user_id: `local-${config.appEnv}` },
    country_codes: ['US'],
    language: 'en',
    ...(config.redirectUri ? { redirect_uri: config.redirectUri } : {}),
  };
  if (connectionId) {
    const c = await activeConnection(connectionId);
    params.access_token = decrypt(c.token);
    Object.assign(params, reconnectLinkOptions);
  } else {
    Object.assign(params, accountLinkProducts);
    // Ask for the longest history Plaid offers; existing Items keep their ~90 days.
    params.transactions = { days_requested: 730 };
  }
  const r = await plaid.linkTokenCreate(params);
  log.info('link.token_created', {
    mode: connectionId ? 'update' : 'new',
    accountSelection: !!params.update?.account_selection_enabled,
  });
  return { link_token: r.data.link_token, products, connectionId: connectionId || null };
}
export async function disconnect(id: string) {
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(931877)');
    const saved = (
      await pool.query('SELECT * FROM connections WHERE id=$1 AND environment=$2', [
        id,
        config.plaidEnv,
      ])
    ).rows[0];
    if (!saved) throw new Error('Connection not found');
    if (saved.disconnected_at) return { message: 'Already disconnected. Saved history retained.' };
    try {
      await plaid.itemRemove({ access_token: decrypt(saved.token) });
    } catch (e: any) {
      if (!['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN'].includes(e.response?.data?.error_code))
        throw e;
    }
    await pool.query(
      "UPDATE connections SET disconnected_at=now(),token='',last_error=NULL WHERE id=$1",
      [id],
    );
    await pool.query("UPDATE accounts SET last_error='DISCONNECTED' WHERE connection_id=$1", [id]);
    return { message: 'Disconnected. Saved balances and history are retained.' };
  } finally {
    await lock.query('SELECT pg_advisory_unlock(931877)');
    lock.release();
  }
}
