import { config } from '../server/lib/config.ts';
if (config.production) throw new Error('Integration fixture tests must never use production');
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pool } from '../server/db/pool.ts';
import { DbAuthStore } from '../server/auth/store.ts';
import { hashPassphrase } from '../server/auth/passphrase.ts';
import { recompute } from '../server/db/queries.ts';
import { planTransactionChanges } from '../server/lib/transactions.ts';
import { excludeUnreturnedAccounts } from '../server/services/sync.ts';
import { applyHoldingPrices, refreshSecurityPrices } from '../server/services/prices.ts';
import { applyTransactionChanges, remapAutoCategories } from '../server/services/transactions.ts';
import { applyInvestmentChanges } from '../server/services/investment-transactions.ts';
import { planInvestmentChanges } from '../server/lib/investment-transactions.ts';
const base = process.env.TEST_BASE_URL || 'http://localhost:3002';
// Sign-in is always required: once the app is up, a throwaway passphrase is created on this disposable database
// and its session cookie goes with every request.
let cookie = '';
async function request(route: string, body?: unknown, method?: string) {
  const r = await fetch(base + '/api' + route, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
for (let i = 0; i < 60; i++) {
  try {
    if ((await request('/health')).status === 200) break;
  } catch {
    // not ready yet
  }
  await new Promise((r) => setTimeout(r, 500));
}
{
  const passphrase = crypto.randomBytes(18).toString('base64url');
  assert.equal((await request('/overview')).status, 401, 'data is blocked before sign-in');
  const created = await request('/auth/setup', { passphrase });
  assert.equal(created.status, 200);
  cookie = String(created.headers.get('set-cookie')).split(';')[0];
  assert.equal((await request('/overview')).status, 200, 'the new session works');
  assert.equal((await request('/auth/setup', { passphrase: passphrase + 'x' })).status, 409);
  assert.equal(
    (await request('/auth/passphrase', { current: 'wrong', passphrase: passphrase + 'x' })).status,
    401,
  );
  console.log('PASS: sign-in required, first passphrase created, setup closed afterwards');
}
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('DELETE FROM accounts');
  for (const [id, kind, balance, currency, included] of [
    ['test-cash', 'cash', '1000', 'USD', true],
    ['test-investment', 'investment', '5000', 'USD', true],
    ['test-debt', 'credit', '200', 'USD', true],
    ['test-credit', 'credit', '-25', 'USD', true],
    ['test-missing', 'cash', null, 'USD', true],
    ['test-fx', 'cash', '100', 'EUR', true],
    ['test-excluded', 'cash', '999', 'USD', false],
  ]) {
    await client.query(
      "INSERT INTO accounts(id,name,institution,kind,currency,included,source) VALUES($1,$1,'Test',$2,$3,$4,'manual')",
      [id, kind, currency, included],
    );
    await client.query(
      "INSERT INTO balance_snapshots(account_id,date,current_balance,provenance) VALUES($1,CURRENT_DATE,$2,'manual')",
      [id, balance],
    );
  }
  await recompute(client);
  let row = (await client.query('SELECT * FROM daily_net_worth ORDER BY date DESC LIMIT 1'))
    .rows[0];
  assert.equal(Number(row.net_worth), 5825);
  assert.equal(row.missing_accounts, 2);
  await client.query(
    "UPDATE balance_snapshots SET current_balance=1100,observed_at=now() WHERE account_id='test-cash'",
  );
  await recompute(client);
  row = (await client.query('SELECT * FROM daily_net_worth ORDER BY date DESC LIMIT 1')).rows[0];
  assert.equal(Number(row.net_worth), 5925);
  assert.equal(
    Number(
      (await client.query("SELECT count(*) FROM balance_observations WHERE account_id='test-cash'"))
        .rows[0].count,
    ),
    2,
  );
  // Imported totals fill days before every included account has live data, then yield to live totals.
  await client.query('DELETE FROM imported_net_worth');
  await client.query(
    "INSERT INTO imported_net_worth(date,assets,liabilities,net_worth,source) VALUES(CURRENT_DATE-2,900,100,800,'test'),(CURRENT_DATE,900,100,800,'test')",
  );
  await client.query(
    "UPDATE balance_snapshots SET provenance='imported',date=CURRENT_DATE-2 WHERE account_id='test-cash'",
  );
  await recompute(client);
  const series = (
    await client.query('SELECT date::text,net_worth FROM daily_net_worth ORDER BY date')
  ).rows;
  assert.equal(Number(series[0].net_worth), 800, 'imported total used before live data');
  assert.equal(
    Number(series[series.length - 1].net_worth),
    5925,
    'live total wins from the cutover day',
  );
  await client.query('ROLLBACK');
  console.log(
    'PASS: actual SQL net worth, signed credits, missing/FX exclusion, intraday observations',
  );
} finally {
  await client.query('ROLLBACK');
  client.release();
}
const before = (await request('/overview')).data;
assert.equal(before.accounts.filter((a: any) => a.source === 'simulated').length, 6);
const bad = await request('/accounts', { name: 'Invalid', kind: 'cash', balance: null });
assert.equal(bad.status, 400);
const made = await request('/accounts', {
  name: 'Verification cash',
  kind: 'cash',
  balance: '123.45',
});
assert.equal(made.status, 200);
const id = made.data.id;
assert.equal((await request('/accounts/' + id, { balance: '234.56' }, 'PATCH')).status, 200);
let overview = (await request('/overview')).data;
assert.equal(Number(overview.accounts.find((a: any) => a.id === id).balance), 234.56);
assert.equal((await request('/accounts/' + id, { included: false }, 'PATCH')).status, 200);
const archive = (await request('/export')).data;
assert.ok(!JSON.stringify(archive).includes('access-sandbox-'));
assert.ok(archive.tables.accounts.every((a: any) => !('token' in a) && !('connection_id' in a)));
const small = {
  version: 1,
  tables: {
    accounts: archive.tables.accounts.filter((a: any) => a.id === id),
    balance_snapshots: archive.tables.balance_snapshots.filter((a: any) => a.account_id === id),
  },
};
assert.equal((await request('/import', small)).status, 200);
assert.equal((await request('/import', small)).status, 200);
overview = (await request('/overview')).data;
assert.equal(overview.accounts.filter((a: any) => a.id === 'import:' + id).length, 1);
const count = overview.accounts.length;
const broken = structuredClone(small);
broken.tables.accounts[0].id = 'invalid-archive';
broken.tables.balance_snapshots[0].account_id = 'nonexistent';
assert.equal((await request('/import', broken)).status, 400);
assert.equal((await request('/overview')).data.accounts.length, count);
const crossSite = await fetch(base + '/api/accounts', {
  method: 'POST',
  headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
  body: '{}',
});
assert.equal(crossSite.status, 403);
console.log(
  'PASS: manual updates, exclusions, archive export, duplicate import, failed import rollback, origin checks',
);

// --- Transactions and categories ---
const listAll = async () => (await request('/transactions?limit=500')).data.transactions;
const all: any[] = [];
let cursor: string | null = null;
do {
  const r: any = await request('/transactions?limit=50' + (cursor ? '&cursor=' + cursor : ''));
  assert.equal(r.status, 200);
  all.push(...r.data.transactions);
  cursor = r.data.nextCursor;
} while (cursor);
assert.ok(all.length > 100, 'seeded demo transactions are listed across pages');
assert.equal(new Set(all.map((t) => t.id)).size, all.length, 'pages do not overlap');
assert.ok(
  all.every((t, i) => i === 0 || all[i - 1].date >= t.date),
  'newest first',
);
assert.ok(
  all.every((t) => t.activity === 'investment' || t.category),
  'every bank and card transaction has an effective category',
);
assert.ok(
  all.some((t) => t.activity === 'investment' && t.category === null),
  'seeded brokerage activity is listed, not counted until categorised',
);
const categories = (await request('/categories')).data.categories;
const groceries = categories.find((c: any) => c.key === 'groceries');
assert.equal(
  categories.reduce((n: number, c: any) => n + c.transaction_count, 0),
  // a split transaction counts once per part; brokerage activity only once categorised
  all
    .filter((t) => t.category || t.splits.length)
    .reduce((n, t) => n + Math.max(1, t.splits.length), 0),
  'category counts add up to the transactions',
);
const byCategory = (await request('/transactions?limit=500&category=' + groceries.id)).data;
assert.ok(byCategory.transactions.length > 0);
assert.ok(
  byCategory.transactions.every(
    (t: any) =>
      t.category.name === 'Groceries' || t.splits.some((p: any) => p.category.name === 'Groceries'),
  ),
);
const search = (await request('/transactions?q=bistro')).data.transactions;
assert.ok(search.length > 0 && search.every((t: any) => /bistro/i.test(t.name + t.merchant_name)));
assert.equal(
  (await request('/transactions?q=%25')).data.transactions.length,
  0,
  'wildcards are literal',
);
const byAccount = (await request('/transactions?limit=500&account=demo-savings')).data.transactions;
assert.ok(byAccount.length > 0 && byAccount.every((t: any) => t.account_id === 'demo-savings'));
assert.equal((await request('/transactions?limit=0')).status, 400);

// Editing: date, category and notes only; every edit can be undone.
// a posted transaction: a pending one cannot be edited
const target = all.find(
  (t) => !t.pending && t.category_source === 'auto' && t.provider_date === t.date,
);
const tid = encodeURIComponent(target.id);
const edited = (
  await request(
    '/transactions/' + tid,
    { date: '2026-01-02', category_id: Number(groceries.id), notes: 'checked' },
    'PATCH',
  )
).data;
assert.equal(edited.date, '2026-01-02');
assert.equal(edited.provider_date, target.provider_date, 'the bank date is kept');
assert.equal(edited.category.name, 'Groceries');
assert.equal(edited.category_source, 'user');
assert.equal(edited.notes, 'checked');
assert.equal(edited.amount, target.amount, 'amount is not editable');
const reset = (await request('/transactions/' + tid, { date: null, category_id: null }, 'PATCH'))
  .data;
assert.equal(reset.date, target.provider_date);
assert.equal(reset.category_source, 'auto');
assert.equal(reset.notes, 'checked');
for (const body of [
  {},
  { date: '2026-02-30' },
  { category_id: 999999 },
  { amount: 1 },
  { notes: 'x'.repeat(2001) },
])
  assert.equal(
    (await request('/transactions/' + tid, body, 'PATCH')).status,
    400,
    JSON.stringify(body),
  );
assert.equal((await request('/transactions/nope', { notes: 'x' }, 'PATCH')).status, 404);
await request('/transactions/' + tid, { notes: '' }, 'PATCH');

// A sync (provider upsert) must never overwrite what the user entered.
await pool.query("DELETE FROM accounts WHERE id='itest:acct'");
await pool.query(
  "INSERT INTO accounts(id,name,institution,kind,source) VALUES('itest:acct','Sync test','Test','cash','manual')",
);
const sync = async (page: any, next: string) =>
  applyTransactionChanges(
    'itest',
    planTransactionChanges(
      'itest',
      [{ added: [], modified: [], removed: [], ...page }],
      new Map([['acct', 'itest:acct']]),
      'plaid_sandbox',
    ),
    next,
  );
const plaidTxn = (id: string, extra: any = {}) => ({
  transaction_id: id,
  account_id: 'acct',
  amount: 10,
  date: '2026-09-01',
  name: 'SYNC TEST SHOP',
  merchant_name: null,
  pending: false,
  ...extra,
});
const listed = async () =>
  (await request('/transactions?limit=500&account=itest:acct')).data.transactions;
await sync({ added: [plaidTxn('pend', { pending: true })] }, 'c1');
assert.equal((await listed()).length, 1);
// The API no longer lets anyone edit a pending row, so this sets what an edit made before that rule
// would have left behind; the carry-over below still has to keep it.
assert.equal((await request('/transactions/itest%3Apend', { notes: 'x' }, 'PATCH')).status, 409);
await pool.query(
  "UPDATE transactions SET notes='keep me',category_id=$1,user_date='2026-09-02' WHERE id='itest:pend'",
  [Number(groceries.id)],
);
// The pending row posts: the posted row inherits the edits and the pending one disappears.
await sync(
  {
    added: [plaidTxn('posted', { pending_transaction_id: 'pend', amount: 11 })],
    removed: [{ transaction_id: 'pend' }],
  },
  'c2',
);
let rows = await listed();
assert.deepEqual(
  rows.map((t: any) => t.id),
  ['itest:posted'],
);
assert.equal(rows[0].notes, 'keep me');
assert.equal(rows[0].category.name, 'Groceries');
assert.equal(rows[0].date, '2026-09-02');
// A later modification changes provider fields only.
await sync(
  { modified: [plaidTxn('posted', { amount: 12, name: 'RENAMED BY BANK', date: '2026-09-05' })] },
  'c3',
);
rows = await listed();
assert.equal(Number(rows[0].amount), 12);
assert.equal(rows[0].name, 'RENAMED BY BANK');
assert.equal(rows[0].provider_date, '2026-09-05');
assert.equal(rows[0].notes, 'keep me');
assert.equal(rows[0].date, '2026-09-02', 'the date the user chose is kept');
// Removed by the bank: hidden, but the user's edits are still stored.
await sync({ removed: [{ transaction_id: 'posted' }] }, 'c4');
assert.equal((await listed()).length, 0);
const kept = (await pool.query("SELECT notes,removed_at FROM transactions WHERE id='itest:posted'"))
  .rows[0];
assert.equal(kept.notes, 'keep me');
assert.ok(kept.removed_at);
await sync({ added: [plaidTxn('posted')] }, 'c5');
assert.equal((await listed()).length, 1, 'a re-added transaction comes back with its notes');
await pool.query("DELETE FROM accounts WHERE id='itest:acct'");

// Groups and categories: Income / Expenses / Transfers, create under a group, move, rename, delete.
const listing = (await request('/categories')).data;
assert.deepEqual(
  [...new Set(listing.groups.map((g: any) => g.type))],
  ['income', 'expense', 'transfer'],
  'groups come back as income, then expense, then transfer',
);
assert.ok(listing.categories.every((c: any) => c.group_id && c.group_name && c.type));
const expenseGroup = listing.groups.find((g: any) => g.type === 'expense' && g.name === 'Other');
const newGroup = await request('/category-groups', {
  name: ' Integration group ',
  type: 'expense',
});
assert.equal(newGroup.status, 200);
assert.equal(
  (await request('/category-groups', { name: 'integration GROUP', type: 'expense' })).status,
  400,
  'group names are unique within a type',
);
assert.equal((await request('/category-groups', { name: 'x', type: 'bogus' })).status, 400);
const madeCategory = await request('/categories', {
  name: ' Integration pets ',
  group_id: newGroup.data.id,
  emoji: '🐶',
});
assert.equal(madeCategory.status, 200);
let pets = (await request('/categories')).data.categories.find(
  (c: any) => c.id === madeCategory.data.id,
);
assert.equal(pets.name, 'Integration pets');
assert.equal(pets.emoji, '🐶');
assert.equal(pets.type, 'expense');
assert.equal(pets.group_name, 'Integration group');
assert.equal(
  (await request('/categories', { name: 'integration PETS', group_id: expenseGroup.id })).status,
  400,
  'category names are unique, ignoring case',
);
assert.equal(
  (await request('/categories', { name: '   ', group_id: expenseGroup.id })).status,
  400,
);
assert.equal((await request('/categories', { name: 'No group' })).status, 400);
assert.equal((await request('/categories', { name: 'Ghost', group_id: 999999 })).status, 400);
assert.equal(
  (await request('/category-groups/' + newGroup.data.id, { name: 'Renamed group' }, 'PATCH'))
    .status,
  200,
);
pets = (await request('/categories')).data.categories.find(
  (c: any) => c.id === madeCategory.data.id,
);
assert.equal(pets.group_name, 'Renamed group', 'renaming a group renames it on its categories');
assert.equal(
  (await request('/category-groups/' + newGroup.data.id, undefined, 'DELETE')).status,
  400,
  'a group with categories cannot be deleted',
);
assert.equal(
  (await request('/categories/' + madeCategory.data.id, { group_id: expenseGroup.id }, 'PATCH'))
    .status,
  200,
);
pets = (await request('/categories')).data.categories.find(
  (c: any) => c.id === madeCategory.data.id,
);
assert.equal(pets.group_name, 'Other', 'a category can move to another group');
assert.equal(
  (await request('/category-groups/' + newGroup.data.id, undefined, 'DELETE')).status,
  200,
  'an empty group can be deleted',
);
assert.equal((await request('/category-groups/999999', undefined, 'DELETE')).status, 404);
assert.equal(
  (await request('/categories/' + madeCategory.data.id, { name: 'Integration cats' }, 'PATCH'))
    .status,
  200,
);
assert.equal(
  (await request('/categories/' + madeCategory.data.id, { name: 'Groceries' }, 'PATCH')).status,
  400,
);
await request('/transactions/' + tid, { category_id: madeCategory.data.id }, 'PATCH');
assert.equal(
  (await request('/transactions?limit=500')).data.transactions.find((t: any) => t.id === target.id)
    .category.name,
  'Integration cats',
);
assert.equal(
  (await request('/categories/' + madeCategory.data.id, undefined, 'DELETE')).status,
  200,
);
const after = (await request('/transactions?limit=500')).data.transactions.find(
  (t: any) => t.id === target.id,
);
assert.equal(
  after.category_source,
  'auto',
  'deleting a category sends its transactions back to automatic',
);
const uncategorized = categories.find((c: any) => c.key === 'uncategorized');
assert.equal((await request('/categories/' + uncategorized.id, undefined, 'DELETE')).status, 400);
assert.equal((await request('/categories/999999', undefined, 'DELETE')).status, 404);
// A pending transaction is read-only until it posts: every way of editing it is refused.
const pendingRow = all.find((t) => t.pending);
assert.ok(pendingRow, 'the demo data has pending transactions');
const pendingId = encodeURIComponent(pendingRow.id);
const readRow = async () =>
  JSON.stringify((await listAll()).find((t: any) => t.id === pendingRow.id));
const pendingBefore = await readRow();
const half = (Number(pendingRow.amount) / 2).toFixed(2);
for (const [why, res] of [
  ['edit notes', await request('/transactions/' + pendingId, { notes: 'x' }, 'PATCH')],
  [
    'edit category',
    await request('/transactions/' + pendingId, { category_id: Number(groceries.id) }, 'PATCH'),
  ],
  ['edit date', await request('/transactions/' + pendingId, { date: '2026-01-01' }, 'PATCH')],
  [
    'split',
    await request(
      '/transactions/' + pendingId + '/splits',
      {
        splits: [
          { amount: half, category_id: null, notes: '' },
          {
            amount: (Number(pendingRow.amount) - Number(half)).toFixed(2),
            category_id: null,
            notes: '',
          },
        ],
      },
      'PUT',
    ),
  ],
  ['remove split', await request('/transactions/' + pendingId + '/splits', undefined, 'DELETE')],
] as const) {
  assert.equal(res.status, 409, why);
  assert.match(res.data.error, /pending transaction cannot be edited until it posts/, why);
}
assert.equal(await readRow(), pendingBefore, 'a refused edit changes nothing');

// Splits: parts with their own amount, category and notes that add up to the transaction.
const keyed = (key: string) => categories.find((c: any) => c.key === key);
const big = all.find(
  (t) =>
    Number(t.amount) > 20 &&
    !t.pending &&
    t.splits.length === 0 &&
    t.account_id.startsWith('demo-'),
);
assert.equal(big.split_balanced, true, 'an unsplit transaction is not flagged');
const bigId = encodeURIComponent(big.id);
const bigCents = Math.round(Number(big.amount) * 100);
const cents = (n: number) => (n / 100).toFixed(2);
const useCats = ['groceries', 'rent', 'gifts']
  .map(keyed)
  .filter((c: any) => c.id !== big.category.id);
const [catA, catB] = useCats;
const firstPart = Math.floor(bigCents / 3);
const parts = [
  { amount: cents(firstPart), category_id: Number(catA.id), notes: 'split part one' },
  { amount: cents(bigCents - firstPart), category_id: Number(catB.id), notes: '' },
];
const put = (id: string, body: unknown) => request('/transactions/' + id + '/splits', body, 'PUT');
for (const [why, body, status] of [
  ['one part', { splits: [parts[0]] }, 400],
  [
    'parts that do not add up',
    { splits: [parts[0], { ...parts[1], amount: cents(bigCents) }] },
    400,
  ],
  [
    'a zero part',
    {
      splits: [
        { ...parts[0], amount: '0' },
        { ...parts[1], amount: cents(bigCents) },
      ],
    },
    400,
  ],
  [
    'wrong sign',
    {
      splits: [
        { ...parts[0], amount: '-' + parts[0].amount },
        { ...parts[1], amount: cents(bigCents + firstPart) },
      ],
    },
    400,
  ],
  ['unknown category', { splits: [{ ...parts[0], category_id: 999999 }, parts[1]] }, 400],
  ['missing fields', { splits: [{ amount: '1' }, parts[1]] }, 400],
] as const)
  assert.equal((await put(bigId, body)).status, status, why);
assert.equal((await put('nope', { splits: parts })).status, 404);
assert.equal((await request('/transactions/' + bigId)).status, 404, 'no such route');
assert.equal(
  (await listAll()).find((t: any) => t.id === big.id).splits.length,
  0,
  'a refused split leaves nothing behind',
);
const split = await put(bigId, { splits: parts });
assert.equal(split.status, 200);
assert.equal(split.data.splits.length, 2);
assert.equal(split.data.split_balanced, true);
assert.deepEqual(
  split.data.splits.map((p: any) => p.category.name),
  [catA.name, catB.name],
);
assert.deepEqual(
  split.data.splits.map((p: any) => p.notes),
  ['split part one', ''],
);
assert.equal(split.data.amount, big.amount, 'the transaction itself is unchanged');
// It belongs to the categories its parts use, not to its own.
const inCategory = async (id: number) =>
  (await request('/transactions?limit=500&category=' + id)).data.transactions.map((t: any) => t.id);
assert.ok((await inCategory(Number(catA.id))).includes(big.id));
assert.ok((await inCategory(Number(catB.id))).includes(big.id));
assert.ok(
  !(await inCategory(Number(big.category.id))).includes(big.id),
  'not under its own category',
);
assert.ok(
  (await request('/transactions?q=split%20part%20one')).data.transactions.some(
    (t: any) => t.id === big.id,
  ),
  'part notes are searchable',
);
const afterSplit = (await request('/categories')).data.categories;
assert.equal(
  afterSplit.reduce((n: number, c: any) => n + c.transaction_count, 0),
  all
    .filter((t) => t.activity !== 'investment')
    .reduce((n, t) => n + Math.max(1, t.splits.length), 0) + 1,
  'a split counts once per part',
);
// Replacing the split replaces every part.
const three = [
  { amount: cents(1), category_id: null, notes: 'a' },
  { amount: cents(1), category_id: Number(catA.id), notes: 'b' },
  { amount: cents(bigCents - 2), category_id: Number(catB.id), notes: 'c' },
];
const replaced = (await put(bigId, { splits: three })).data;
assert.deepEqual(
  replaced.splits.map((p: any) => p.notes),
  ['a', 'b', 'c'],
);
assert.equal(
  replaced.splits[0].category.name,
  'Uncategorized',
  'no category shows as Uncategorized',
);
// Each part can have its own date; null (or none) means the transaction's date.
const dated = (
  await put(bigId, {
    splits: [{ ...three[0], date: '2026-01-15' }, { ...three[1], date: null }, three[2]],
  })
).data;
assert.deepEqual(
  dated.splits.map((p: any) => p.date),
  ['2026-01-15', null, null],
);
assert.equal(dated.date, big.date, 'the transaction keeps its own date');
for (const date of ['2026-02-30', '2999-01-01', 'soon', 5])
  assert.equal(
    (await put(bigId, { splits: [{ ...three[0], date }, three[1], three[2]] })).status,
    400,
    String(date),
  );
assert.deepEqual(
  (await listAll()).find((t: any) => t.id === big.id).splits.map((p: any) => p.date),
  ['2026-01-15', null, null],
  'a refused request changes nothing',
);
// If the bank later changes the amount, the split is flagged rather than silently wrong.
await pool.query('UPDATE transactions SET amount=amount+5 WHERE id=$1', [big.id]);
assert.equal((await listAll()).find((t: any) => t.id === big.id).split_balanced, false);
assert.equal((await put(bigId, { splits: three })).status, 400, 'and it must be fixed to add up');
await pool.query('UPDATE transactions SET amount=amount-5 WHERE id=$1', [big.id]);
assert.equal((await listAll()).find((t: any) => t.id === big.id).split_balanced, true);
// Removing the split puts the transaction back under its own category.
const removed = await request('/transactions/' + bigId + '/splits', undefined, 'DELETE');
assert.equal(removed.status, 200);
assert.deepEqual(removed.data.splits, []);
assert.ok((await inCategory(Number(big.category.id))).includes(big.id));
assert.equal(
  (await request('/transactions/' + bigId + '/splits', undefined, 'DELETE')).status,
  200,
);
assert.equal((await request('/transactions/nope/splits', undefined, 'DELETE')).status, 404);
// Money in is split into money in.
const refundRow = all.find((t) => Number(t.amount) < -1 && t.account_id.startsWith('demo-'));
const refundCents = Math.round(-Number(refundRow.amount) * 100);
const refundId = encodeURIComponent(refundRow.id);
assert.equal(
  (
    await put(refundId, {
      splits: [
        { ...parts[0], amount: cents(1) },
        { ...parts[1], amount: cents(refundCents - 1) },
      ],
    })
  ).status,
  400,
  'positive parts for money in',
);
assert.equal(
  (
    await put(refundId, {
      splits: [
        { ...parts[0], amount: '-' + cents(1) },
        { ...parts[1], amount: '-' + cents(refundCents - 1) },
      ],
    })
  ).status,
  200,
);
await request('/transactions/' + refundId + '/splits', undefined, 'DELETE');

// A pending transaction that posts keeps its split, unless the amount changed.
await pool.query("DELETE FROM accounts WHERE id='itest:acct'");
await pool.query(
  "INSERT INTO accounts(id,name,institution,kind,source) VALUES('itest:acct','Sync test','Test','cash','manual')",
);
await sync(
  { added: [plaidTxn('p-same', { pending: true }), plaidTxn('p-diff', { pending: true })] },
  's1',
);
const tenSplit = [
  { amount: '6.00', category_id: Number(catA.id), notes: 'x', date: '2026-09-20' },
  { amount: '4.00', category_id: Number(catB.id), notes: 'y' },
];
// (Pending rows cannot be split through the API either, so the parts are written directly.)
assert.equal((await put('itest%3Ap-same', { splits: tenSplit })).status, 409);
for (const id of ['itest:p-same', 'itest:p-diff'])
  for (const [i, part] of tenSplit.entries())
    await pool.query(
      'INSERT INTO transaction_splits(transaction_id,amount,category_id,notes,sort_order,date) VALUES($1,$2,$3,$4,$5,$6)',
      [id, part.amount, part.category_id, part.notes, i, part.date ?? null],
    );
await sync(
  {
    added: [
      plaidTxn('same', { pending_transaction_id: 'p-same' }),
      plaidTxn('diff', { pending_transaction_id: 'p-diff', amount: 11 }),
    ],
    removed: [{ transaction_id: 'p-same' }, { transaction_id: 'p-diff' }],
  },
  's2',
);
const posted = await listed();
assert.deepEqual(posted.map((t: any) => t.id).sort(), ['itest:diff', 'itest:same']);
assert.equal(
  posted.find((t: any) => t.id === 'itest:same').splits.length,
  2,
  'same amount: split carried over',
);
assert.equal(
  posted.find((t: any) => t.id === 'itest:diff').splits.length,
  0,
  'amount changed: no split',
);
await pool.query("DELETE FROM accounts WHERE id='itest:acct'");
assert.equal(
  Number(
    (
      await pool.query(
        "SELECT count(*) FROM transaction_splits WHERE transaction_id LIKE 'itest:%'",
      )
    ).rows[0].count,
  ),
  0,
  'parts go with their transaction',
);
const crossSiteSplit = await fetch(base + '/api/transactions/' + bigId + '/splits', {
  method: 'PUT',
  headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
  body: JSON.stringify({ splits: parts }),
});
assert.equal(crossSiteSplit.status, 403);

// Manual transactions: RSU vests, 401(k) contributions and the like, on any account.
await pool.query("DELETE FROM accounts WHERE id LIKE 'itest-man-%'");
await pool.query(
  `INSERT INTO accounts(id,name,institution,kind,source,currency) VALUES
   ('itest-man-401k','Test 401(k)','Test Plan','investment','manual','USD'),
   ('itest-man-rsu','Test Equity Awards','Test Broker','investment','manual','USD')`,
);
const incomeCats = (await request('/categories')).data.categories;
const incomeKey = (key: string) => incomeCats.find((c: any) => c.key === key);
for (const key of ['rsu', 'espp', '401k_contribution', 'hsa', 'dividends_gains']) {
  assert.ok(incomeKey(key), key + ' is seeded');
  assert.equal(incomeKey(key).type, 'income', key + ' is income');
}
const rsu = incomeKey('rsu');
const manualCount = async () =>
  Number(
    (
      await pool.query(
        "SELECT count(*) FROM transactions WHERE source='manual' AND account_id LIKE 'itest-man-%'",
      )
    ).rows[0].count,
  );
assert.equal(await manualCount(), 0);
const addedRsu = await request('/transactions', {
  account_id: 'itest-man-rsu',
  date: '2026-09-15',
  amount: '12500.00',
  direction: 'in',
  name: '  RSU vest AVGO ',
  category_id: Number(rsu.id),
  notes: 'Q3 vest',
});
assert.equal(addedRsu.status, 200);
const r1 = addedRsu.data;
assert.ok(r1.id.startsWith('manual:'));
assert.deepEqual(
  [
    r1.source,
    Number(r1.amount),
    r1.date,
    r1.provider_date,
    r1.user_date,
    r1.name,
    r1.merchant_name,
    r1.notes,
    r1.pending,
    r1.category.name,
    r1.category_source,
    r1.account_name,
    r1.splits.length,
  ],
  [
    'manual',
    -12500,
    '2026-09-15',
    '2026-09-15',
    null,
    'RSU vest AVGO',
    'RSU vest AVGO',
    'Q3 vest',
    false,
    'RSU',
    'user',
    'Test Equity Awards',
    0,
  ],
  'money in is stored as the bank would: negative',
);
const out = await request('/transactions', {
  account_id: 'itest-man-401k',
  date: '2026-09-20',
  amount: 40.5,
  direction: 'out',
  name: 'Fee',
});
assert.equal(out.status, 200);
assert.equal(Number(out.data.amount), 40.5);
assert.equal(out.data.category_source, 'none', 'no category chosen');
assert.equal(await manualCount(), 2);
const onAccount = (await request('/transactions?account=itest-man-rsu')).data.transactions;
assert.deepEqual(
  onAccount.map((t: any) => t.id),
  [r1.id],
);
assert.equal(
  (await request('/categories')).data.categories.find((c: any) => c.key === 'rsu')
    .transaction_count,
  Number(rsu.transaction_count) + 1,
  'it counts under its category',
);
for (const [why, body] of [
  [
    'an unknown account',
    { account_id: 'nope', date: '2026-09-15', amount: '1', direction: 'in', name: 'x' },
  ],
  [
    'no name',
    { account_id: 'itest-man-rsu', date: '2026-09-15', amount: '1', direction: 'in', name: '   ' },
  ],
  [
    'a zero amount',
    { account_id: 'itest-man-rsu', date: '2026-09-15', amount: '0', direction: 'in', name: 'x' },
  ],
  [
    'a negative amount',
    { account_id: 'itest-man-rsu', date: '2026-09-15', amount: '-5', direction: 'in', name: 'x' },
  ],
  [
    'three decimals',
    {
      account_id: 'itest-man-rsu',
      date: '2026-09-15',
      amount: '1.234',
      direction: 'in',
      name: 'x',
    },
  ],
  [
    'a thousands separator',
    {
      account_id: 'itest-man-rsu',
      date: '2026-09-15',
      amount: '1,000',
      direction: 'in',
      name: 'x',
    },
  ],
  [
    'text for an amount',
    { account_id: 'itest-man-rsu', date: '2026-09-15', amount: 'abc', direction: 'in', name: 'x' },
  ],
  ['no direction', { account_id: 'itest-man-rsu', date: '2026-09-15', amount: '1', name: 'x' }],
  [
    'a bad direction',
    {
      account_id: 'itest-man-rsu',
      date: '2026-09-15',
      amount: '1',
      direction: 'sideways',
      name: 'x',
    },
  ],
  [
    'a bad date',
    { account_id: 'itest-man-rsu', date: '2026-02-30', amount: '1', direction: 'in', name: 'x' },
  ],
  [
    'a far-future date',
    { account_id: 'itest-man-rsu', date: '2999-01-01', amount: '1', direction: 'in', name: 'x' },
  ],
  [
    'an unknown category',
    {
      account_id: 'itest-man-rsu',
      date: '2026-09-15',
      amount: '1',
      direction: 'in',
      name: 'x',
      category_id: 999999,
    },
  ],
  [
    'an extra field',
    {
      account_id: 'itest-man-rsu',
      date: '2026-09-15',
      amount: '1',
      direction: 'in',
      name: 'x',
      pending: true,
    },
  ],
] as const)
  assert.equal((await request('/transactions', body)).status, 400, why);
assert.equal(await manualCount(), 2, 'refusals add nothing');

// What you added can be changed freely: name, amount, direction, account, date, category, notes.
const mid = encodeURIComponent(r1.id);
const patch = async (body: unknown) => request('/transactions/' + mid, body, 'PATCH');
assert.equal(
  Number((await patch({ amount: '13000' })).data.amount),
  -13000,
  'the direction is kept',
);
assert.equal(
  Number((await patch({ direction: 'out' })).data.amount),
  13000,
  'a direction can change alone',
);
assert.equal(Number((await patch({ direction: 'in', amount: 12500 })).data.amount), -12500);
const renamed = (await patch({ name: ' RSU vest (AVGO, Q3) ' })).data;
assert.deepEqual(
  [renamed.name, renamed.merchant_name],
  ['RSU vest (AVGO, Q3)', 'RSU vest (AVGO, Q3)'],
);
assert.equal((await patch({ account_id: 'itest-man-401k' })).data.account_name, 'Test 401(k)');
assert.equal((await patch({ account_id: 'nope' })).status, 400);
const moved = (
  await patch({
    date: '2026-09-16',
    category_id: Number(incomeKey('401k_contribution').id),
    notes: '',
  })
).data;
assert.deepEqual(
  [moved.date, moved.provider_date, moved.user_date, moved.category.name, moved.notes],
  ['2026-09-16', '2026-09-16', null, '401k contribution', ''],
  'its date is its date: no separate bank date',
);
assert.equal((await patch({ date: null })).status, 400, 'a manual transaction needs a date');
for (const bad of [
  { amount: '0' },
  { amount: '-1' },
  { name: '' },
  { direction: 'x' },
  { account_id: '' },
  {},
])
  assert.equal((await patch(bad)).status, 400, JSON.stringify(bad));
// It can be split like any other; a changed amount is then flagged.
const manualSplit = await request(
  '/transactions/' + mid + '/splits',
  {
    splits: [
      { amount: '-6000.00', category_id: Number(rsu.id), notes: '' },
      { amount: '-6500.00', category_id: Number(rsu.id), notes: '' },
    ],
  },
  'PUT',
);
assert.equal(manualSplit.status, 200);
assert.equal((await patch({ amount: '12600' })).data.split_balanced, false);
// The bank's own transactions keep their name, amount and account: only your own can change them.
const bankRow = all.find((t: any) => !t.pending && t.source === 'plaid' && t.splits.length === 0);
const bankId = encodeURIComponent(bankRow.id);
for (const body of [
  { name: 'x' },
  { amount: '5' },
  { direction: 'in' },
  { account_id: 'itest-man-401k' },
]) {
  const res = await request('/transactions/' + bankId, body, 'PATCH');
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(res.data.error, /Only a transaction you added yourself/);
}
// Only what you added can be deleted.
assert.equal((await request('/transactions/' + bankId, undefined, 'DELETE')).status, 400);
assert.ok(
  (await listAll()).some((t: any) => t.id === bankRow.id),
  'a bank transaction is never deleted',
);
assert.equal((await request('/transactions/nope', undefined, 'DELETE')).status, 404);
assert.equal((await request('/transactions/' + mid, undefined, 'DELETE')).status, 200);
assert.ok(!(await listAll()).some((t: any) => t.id === r1.id));
assert.equal((await request('/transactions/' + mid, undefined, 'DELETE')).status, 404);
assert.equal(
  Number(
    (await pool.query('SELECT count(*) FROM transaction_splits WHERE transaction_id=$1', [r1.id]))
      .rows[0].count,
  ),
  0,
  'its split parts go with it',
);
const crossSiteAdd = await fetch(base + '/api/transactions', {
  method: 'POST',
  headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    account_id: 'itest-man-rsu',
    date: '2026-09-15',
    amount: '1',
    direction: 'in',
    name: 'x',
  }),
});
assert.equal(crossSiteAdd.status, 403);
await pool.query("DELETE FROM accounts WHERE id LIKE 'itest-man-%'");

// Monarch CSV import: bank and card accounts only; Plaid keeps what it has and Monarch fills in.
await pool.query("DELETE FROM accounts WHERE id LIKE 'itest-m-%'");
await pool.query(
  `INSERT INTO accounts(id,name,institution,kind,mask,source) VALUES
   ('itest-m-card','Test Rewards','Test Bank','credit','1111','manual'),
   ('itest-m-check','Test Checking','Test Bank','cash','2222','manual')`,
);
const plaidSql =
  "INSERT INTO transactions(id,account_id,source,date,amount,name,provenance,category_id,notes) VALUES($1,$2,'plaid',$3,$4,$5,'plaid_sandbox',$6,$7)";
// Plaid's history starts 2026-07-06 (card) and 2026-07-10 (checking); one row already has the owner's own edits.
await pool.query(plaidSql, ['itest-mp1', 'itest-m-card', '2026-07-06', '9.99', 'FIRST', null, '']);
await pool.query(plaidSql, [
  'itest-mp2',
  'itest-m-card',
  '2026-08-11',
  '25.00',
  'DINNER',
  null,
  '',
]);
await pool.query(plaidSql, [
  'itest-mp3',
  'itest-m-card',
  '2026-08-20',
  '12.00',
  'MINE',
  Number(groceries.id),
  'my note',
]);
await pool.query(plaidSql, [
  'itest-mp4',
  'itest-m-check',
  '2026-07-10',
  '-3200.00',
  'PAYROLL',
  null,
  '',
]);
// A pending Plaid row is replaced when it posts, so the import never fills it in.
await pool.query(plaidSql, [
  'itest-mp5',
  'itest-m-card',
  '2026-09-01',
  '33.00',
  'PENDING SHOP',
  null,
  '',
]);
await pool.query("UPDATE transactions SET pending=true WHERE id='itest-mp5'");
const mcsv = [
  'Date,Merchant,Category,Account,Original Statement,Notes,Amount,Tags,Owner,Reviewed,Id',
  '2026-05-01,Old Shop,Groceries,Test Rewards (...1111),OLD SHOP,bbq,-40.00,,,,itest-m1',
  '2026-04-02,Dog Place,Itest Dogs,Test Rewards (...1111),DOG PLACE,,-15.50,,,,itest-m2',
  '2026-04-03,Refund,Itest Refunds,Test Rewards (...1111),REFUND,,20.00,,,,itest-m3',
  '2026-08-10,Dinner,Rent,Test Rewards (...1111),DINNER,from monarch,-25.00,,,,itest-m4',
  '2026-08-20,Mine,Rent,Test Rewards (...1111),MINE,monarch note,-12.00,,,,itest-m5',
  '2026-08-15,Nothing Matches,Groceries,Test Rewards (...1111),NO MATCH,,-77.00,,,,itest-m6',
  '2026-03-01,Acme,Paychecks,Test Checking (...2222),ACME,,"3,200.00",,,,itest-m7',
  '2026-07-10,Acme,Itest Salary,Test Checking (...2222),PAYROLL,,"3,200.00",,,,itest-m8',
  '2026-03-01,Apple,Shopping,Apple Card,APPLE,,-9.00,,,,itest-m9',
  '2026-03-01,Fund,Buy,Roth IRA (...5555),FUND,,-9.00,,,,itest-m10',
  '2999-01-01,Later,Shopping,Test Rewards (...1111),LATER,,-1.00,,,,itest-m11',
  '2026-03-02,Bad,Shopping,Test Rewards (...1111),BAD,,abc,,,,itest-m12',
  '2026-09-01,Pending Shop,Rent,Test Rewards (...1111),PENDING SHOP,would fill,-33.00,,,,itest-m13',
].join('\n');
const doImport = (csv: unknown, commit: unknown) =>
  request('/transactions/import-monarch', { csv, commit });
const countRows = async () =>
  Number((await pool.query('SELECT count(*) FROM transactions')).rows[0].count);
const rowsBefore = await countRows();
const categoriesBefore = (await request('/categories')).data.categories.length;

const dry = await doImport(mcsv, false);
assert.equal(dry.status, 200);
assert.equal(dry.data.committed, false);
assert.equal(await countRows(), rowsBefore, 'a dry run writes nothing');
assert.equal(
  (await request('/categories')).data.categories.length,
  categoriesBefore,
  'nor any category',
);
assert.deepEqual(dry.data.totals, {
  rows: 12,
  notBankOrCard: 2,
  toImport: 4,
  toMerge: 2,
  keptYours: 1,
  leftOut: 2, // m6, and m13 whose only Plaid match is still pending
  alreadyImported: 0,
});
assert.equal(dry.data.futureRows, 1);
assert.deepEqual([dry.data.unreadableRows, dry.data.unreadableLines], [1, [13]]);
assert.deepEqual(dry.data.newCategories.map((c: any) => [c.name, c.income]).sort(), [
  ['Itest Dogs', false],
  ['Itest Refunds', true],
  ['Itest Salary', true],
]);
const skipped = dry.data.accounts
  .filter((a: any) => a.skipped)
  .map((a: any) => a.label)
  .sort();
assert.deepEqual(skipped, ['Apple Card', 'Roth IRA (...5555)']);
const shown = JSON.stringify(dry.data);
for (const secret of ['OLD SHOP', 'bbq', 'from monarch', '3,200', 'DOG PLACE'])
  assert.ok(!shown.includes(secret), 'the response never repeats transaction details: ' + secret);

const done = await doImport(mcsv, true);
assert.equal(done.status, 200);
assert.deepEqual(done.data.applied, { imported: 4, merged: 2, categoriesCreated: 3 });
assert.equal(await countRows(), rowsBefore + 4);
const one = async (id: string) =>
  (
    await pool.query(
      'SELECT t.*,c.name AS category FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.id=$1',
      [id],
    )
  ).rows[0];
const m1 = await one('monarch:itest-m1');
assert.deepEqual(
  [
    m1.source,
    m1.account_id,
    m1.date.toISOString().slice(0, 10),
    Number(m1.amount),
    m1.name,
    m1.merchant_name,
    m1.notes,
    m1.category,
    m1.provenance,
    m1.provider_id,
  ],
  [
    'monarch',
    'itest-m-card',
    '2026-05-01',
    40,
    'OLD SHOP',
    'Old Shop',
    'bbq',
    'Groceries',
    'monarch_import',
    null,
  ],
  "Monarch's expense is money out in the provider sign",
);
assert.equal(Number((await one('monarch:itest-m3')).amount), -20, 'Monarch income is money in');
assert.equal(
  Number((await one('monarch:itest-m7')).amount),
  -3200,
  'thousands separators are read',
);
assert.equal((await one('monarch:itest-m2')).category, 'Itest Dogs');
// A Plaid row the Monarch row matches gains its category and notes...
assert.deepEqual(
  [(await one('itest-mp2')).category, (await one('itest-mp2')).notes],
  ['Rent', 'from monarch'],
);
assert.equal((await one('itest-mp4')).category, 'Itest Salary');
// ...but the owner's own choices are never overwritten, and rows with no match are not added.
assert.deepEqual(
  [(await one('itest-mp3')).category, (await one('itest-mp3')).notes],
  ['Groceries', 'my note'],
);
assert.equal((await one('itest-mp1')).category, null);
assert.deepEqual(
  [(await one('itest-mp5')).category, (await one('itest-mp5')).notes],
  [null, ''],
  'a pending row is never filled in',
);
assert.equal(
  await one('monarch:itest-m6'),
  undefined,
  "inside Plaid's window with no match: left out",
);
assert.equal(await one('monarch:itest-m4'), undefined, 'a matched row is not added a second time');
for (const skippedId of ['m9', 'm10', 'm11', 'm12'])
  assert.equal(await one('monarch:itest-' + skippedId), undefined);
const groupRows = (
  await pool.query(
    `SELECT c.name,g.type,g.name AS g FROM categories c JOIN category_groups g ON g.id=c.group_id WHERE c.name LIKE 'Itest %' ORDER BY c.name`,
  )
).rows;
assert.deepEqual(
  groupRows.map((r: any) => [r.name, r.type, r.g]),
  [
    ['Itest Dogs', 'expense', 'Imported from Monarch'],
    ['Itest Refunds', 'income', 'Imported from Monarch'],
    ['Itest Salary', 'income', 'Imported from Monarch'],
  ],
);
const shownRows = (await request('/transactions?limit=500&account=itest-m-card')).data.transactions;
const shownM1 = shownRows.find((t: any) => t.id === 'monarch:itest-m1');
assert.deepEqual(
  [shownM1.date, shownM1.category.name, shownM1.category_source, shownM1.notes],
  ['2026-05-01', 'Groceries', 'user', 'bbq'],
);

// Importing again changes nothing.
const again = await doImport(mcsv, true);
assert.deepEqual(again.data.applied, { imported: 0, merged: 0, categoriesCreated: 0 });
assert.equal(again.data.totals.alreadyImported, 4);
assert.equal(again.data.totals.toMerge, 0);
assert.equal(again.data.totals.keptYours, 3);
assert.equal(await countRows(), rowsBefore + 4);

// Bad requests.
for (const [why, csv, commit] of [
  ['not a Monarch file', 'Name,Value\nx,1', false],
  ['a missing column', 'Date,Amount\n2026-01-01,5', false],
  ['an empty file', '', false],
  ['an unclosed quote', mcsv + '\n"oops', false],
  ['no commit flag', mcsv, 'yes'],
  ['a number for the file', 5, false],
] as const)
  assert.equal((await doImport(csv, commit)).status, 400, why);
assert.equal(
  (await request('/transactions/import-monarch', { csv: mcsv })).status,
  400,
  'commit is required',
);
assert.equal(await countRows(), rowsBefore + 4, 'refused requests change nothing');
const crossSiteImport = await fetch(base + '/api/transactions/import-monarch', {
  method: 'POST',
  headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
  body: JSON.stringify({ csv: mcsv, commit: true }),
});
assert.equal(crossSiteImport.status, 403);
await pool.query("DELETE FROM accounts WHERE id LIKE 'itest-m-%'");
await pool.query("DELETE FROM categories WHERE name LIKE 'Itest %'");
await pool.query(
  "DELETE FROM category_groups g WHERE g.name='Imported from Monarch' AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.group_id=g.id)",
);

// Start-up remap: a stale automatic category is corrected; the user's own choices are not touched.
await pool.query(
  "UPDATE transactions SET auto_category_key='uncategorized' WHERE id=ANY($1::text[])",
  [[target.id, 'demo-txn-001']],
);
await request('/transactions/' + tid, { category_id: Number(groceries.id) }, 'PATCH');
assert.ok((await remapAutoCategories()) >= 1);
const remapped = (
  await pool.query(
    'SELECT id,auto_category_key,category_id FROM transactions WHERE id=ANY($1::text[])',
    [[target.id, 'demo-txn-001']],
  )
).rows;
assert.equal(remapped.find((r: any) => r.id === 'demo-txn-001').auto_category_key, 'paychecks');
assert.equal(
  Number(remapped.find((r: any) => r.id === target.id).category_id),
  Number(groceries.id),
  'user choice kept',
);
assert.equal(await remapAutoCategories(), 0, 'a second remap changes nothing');
await request('/transactions/' + tid, { category_id: null }, 'PATCH');
const crossSiteEdit = await fetch(base + '/api/transactions/' + tid, {
  method: 'PATCH',
  headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
  body: '{"notes":"x"}',
});
assert.equal(crossSiteEdit.status, 403);
// --- Reports: what counts as income and spending ---
{
  await pool.query("DELETE FROM accounts WHERE id IN ('rpt:a','rpt:fx')");
  for (const [id, currency] of [
    ['rpt:a', 'USD'],
    ['rpt:fx', 'EUR'],
  ])
    await pool.query(
      "INSERT INTO accounts(id,name,institution,kind,currency,source) VALUES($1,$1,'Test','cash',$2,'manual')",
      [id, currency],
    );
  const catId = async (key: string) =>
    Number((await pool.query('SELECT id FROM categories WHERE key=$1', [key])).rows[0].id);
  const add = async (
    id: string,
    date: string,
    amount: number,
    key: string,
    extra: { account?: string; userDate?: string; removed?: boolean } = {},
  ) =>
    pool.query(
      `INSERT INTO transactions(id,account_id,source,date,amount,currency,name,auto_category_key,provenance,user_date,removed_at)
       VALUES($1,$2,'plaid',$3,$4,$5,$1,$6,'simulated',$7,$8)`,
      [
        'rpt-' + id,
        extra.account ?? 'rpt:a',
        date,
        amount,
        (extra.account ?? 'rpt:a') === 'rpt:fx' ? 'EUR' : 'USD',
        key,
        extra.userDate ?? null,
        extra.removed ? new Date() : null,
      ],
    );
  await add('pay', '2026-01-10', -1000, 'paychecks');
  await add('rent', '2026-01-15', 400, 'rent');
  await add('food', '2026-01-20', 100, 'groceries');
  await add('refund', '2026-02-05', -30, 'groceries');
  await add('cardpay', '2026-02-06', 300, 'credit_card_payment');
  await add('uncat-in', '2026-02-10', -50, 'uncategorized');
  await add('uncat-out', '2026-02-11', 20, 'uncategorized');
  await add('moved', '2026-01-31', 10, 'groceries', { userDate: '2026-02-01' });
  await add('split', '2026-01-25', 200, 'shopping');
  await add('gone', '2026-01-12', 999, 'groceries', { removed: true });
  await add('euro', '2026-01-12', 500, 'groceries', { account: 'rpt:fx' });
  // A pending transaction is not counted until it posts (Monarch skips them too); every figure below
  // would change if it were: it is $777 of groceries and $333 of pay inside the range.
  await add('pending-out', '2026-02-12', 777, 'groceries');
  await add('pending-in', '2026-02-13', -333, 'paychecks');
  await pool.query(
    "UPDATE transactions SET pending=true WHERE id IN ('rpt-pending-out','rpt-pending-in')",
  );
  const groceriesId = await catId('groceries');
  const shoppingId = await catId('shopping');
  await pool.query(
    "INSERT INTO transaction_splits(transaction_id,amount,category_id,notes,sort_order,date) VALUES('rpt-split',120,$1,'',0,NULL),('rpt-split',80,$2,'',1,'2026-02-03')",
    [groceriesId, shoppingId],
  );

  const q = 'from=2026-01-01&to=2026-03-31&accounts=rpt:a';
  const flow = (await request('/reports/cash-flow?' + q)).data;
  assert.deepEqual(
    [flow.totals.income, flow.totals.expenses, flow.totals.net, flow.totals.savings_rate],
    ['1050.00', '700.00', '350.00', 33.3],
    'transfers, removed rows and other currencies are left out; refunds reduce spending',
  );
  assert.deepEqual(
    flow.series.map((p: any) => [p.start, p.income, p.expenses, p.partial]),
    [
      ['2026-01-01', '1000.00', '620.00', false],
      ['2026-02-01', '50.00', '80.00', false],
      ['2026-03-01', '0.00', '0.00', false],
    ],
    'split parts count on their own date; the user date wins; empty months are zeros',
  );
  // The lists the reports show agree with their totals: no pending rows under a report's type filter...
  for (const type of ['expense', 'income']) {
    const listed = (await request('/transactions?limit=500&type=' + type + '&' + q)).data
      .transactions;
    assert.ok(
      listed.length > 0 && listed.every((t: any) => !t.pending),
      'no pending rows in the ' + type + ' list',
    );
    assert.ok(
      !listed.some((t: any) => t.id.startsWith('rpt-pending')),
      'neither of the pending rows',
    );
  }
  // ...while the ordinary list still shows them.
  const plainList = (await request('/transactions?limit=500&accounts=rpt:a')).data.transactions;
  assert.ok(
    plainList.some((t: any) => t.id === 'rpt-pending-out' && t.pending),
    'the transactions list shows pending rows',
  );
  // Once the bank posts them they count.
  await pool.query("UPDATE transactions SET pending=false WHERE id='rpt-pending-out'");
  const posted = (await request('/reports/cash-flow?' + q)).data;
  assert.equal(posted.totals.expenses, '1477.00', 'a posted transaction counts: 700 + 777');
  await pool.query("UPDATE transactions SET pending=true WHERE id='rpt-pending-out'");
  assert.deepEqual(
    flow.breakdown.expenses.map((s: any) => [s.category.name, s.amount]),
    [
      ['Rent', '400.00'],
      ['Groceries', '200.00'],
      ['Shopping', '80.00'],
      ['Uncategorized', '20.00'],
    ],
  );
  assert.deepEqual(
    flow.breakdown.income.map((s: any) => [s.category.name, s.amount]),
    [
      ['Paychecks', '1000.00'],
      ['Uncategorized', '50.00'],
    ],
    'uncategorized money in counts as income',
  );
  assert.ok(flow.skipped_non_usd >= 1);

  const feb = (
    await request('/reports/cash-flow?' + q + '&breakdownFrom=2026-02-01&breakdownTo=2026-02-28')
  ).data;
  assert.equal(feb.totals.income, '1050.00', 'the chart keeps the whole range');
  assert.deepEqual(
    [feb.breakdown.totals.income, feb.breakdown.totals.expenses],
    ['50.00', '80.00'],
  );

  const quarter = (await request('/reports/cash-flow?' + q + '&interval=quarter')).data;
  assert.deepEqual(
    quarter.series.map((p: any) => [p.start, p.income, p.expenses]),
    [['2026-01-01', '1050.00', '700.00']],
  );
  const partial = (await request('/reports/cash-flow?accounts=rpt:a&from=2026-01-15&to=2026-02-10'))
    .data;
  assert.deepEqual(
    partial.series.map((p: any) => p.partial),
    [true, true],
    'a range that cuts a month marks it partial',
  );
  const everything = (await request('/reports/cash-flow?accounts=rpt:a')).data;
  assert.equal(everything.series[0].start, '2026-01-01', 'no range = from the first transaction');
  assert.equal(everything.first_date, '2026-01-10');
  const toToday = (await request('/reports/cash-flow?accounts=rpt:a&today=2026-04-10')).data;
  assert.deepEqual(
    toToday.series.map((p: any) => [p.start, p.partial]),
    [
      ['2026-01-01', false],
      ['2026-02-01', false],
      ['2026-03-01', false],
      ['2026-04-01', true],
    ],
    'with the browser date the chart runs to the current month, which is the unfinished one',
  );
  assert.equal(toToday.last_date, '2026-02-11');

  const onlyFood = (await request('/reports/cash-flow?' + q + '&categories=' + groceriesId)).data;
  assert.deepEqual([onlyFood.totals.income, onlyFood.totals.expenses], ['0.00', '200.00']);
  const noAccount = (
    await request('/reports/cash-flow?from=2026-01-01&to=2026-03-31&accounts=none')
  ).data;
  assert.deepEqual([noAccount.totals.income, noAccount.series.length], ['0.00', 3]);

  const spending = (await request('/reports/categories?type=expense&' + q)).data;
  assert.equal(spending.total, '700.00');
  assert.deepEqual(
    [
      spending.summary.count,
      spending.summary.largest,
      spending.summary.average,
      spending.summary.first_date,
      spending.summary.last_date,
    ],
    [6, '400.00', '116.67', '2026-01-15', '2026-02-11'],
  );
  assert.equal(spending.slices[0].share, 57.1);
  const income = (await request('/reports/categories?type=income&' + q)).data;
  assert.deepEqual([income.total, income.summary.count], ['1050.00', 2]);

  const ids = async (extra: string) =>
    (await request('/transactions?limit=500&accounts=rpt:a&' + extra)).data.transactions
      .map((t: any) => t.id)
      .sort();
  assert.deepEqual(await ids('type=income'), ['rpt-pay', 'rpt-uncat-in']);
  assert.deepEqual(await ids('type=expense'), [
    'rpt-food',
    'rpt-moved',
    'rpt-refund',
    'rpt-rent',
    'rpt-split',
    'rpt-uncat-out',
  ]);
  assert.deepEqual(
    await ids('type=expense&from=2026-02-01&to=2026-02-28'),
    ['rpt-moved', 'rpt-refund', 'rpt-split', 'rpt-uncat-out'],
    'a split transaction is in a month when one of its parts is',
  );
  assert.deepEqual(await ids(`categories=${shoppingId},${groceriesId}&type=expense`), [
    'rpt-food',
    'rpt-moved',
    'rpt-refund',
    'rpt-split',
  ]);
  assert.equal((await request('/transactions?accounts=rpt:a&type=transfer')).status, 400);

  // A merchant is its merchant name, else the statement text, compared ignoring case.
  await pool.query(
    "UPDATE transactions SET merchant_name='Corner Cafe' WHERE id IN ('rpt-food','rpt-refund')",
  );
  await pool.query(
    "UPDATE transactions SET merchant_name='',name='CORNER CAFE' WHERE id='rpt-rent'",
  );
  const cafe = (await request('/transactions?limit=1&accounts=rpt:a&merchant=corner%20cafe')).data;
  assert.equal(cafe.total, 3, 'the count ignores paging and the limit');
  assert.equal(cafe.transactions.length, 1);
  assert.deepEqual(await ids('merchant=Corner%20Cafe'), ['rpt-food', 'rpt-refund', 'rpt-rent']);
  assert.equal((await request('/transactions?accounts=rpt:a&limit=5')).data.total, undefined);
  const cafeFlow = (await request('/reports/cash-flow?' + q + '&merchant=CORNER%20CAFE')).data;
  assert.deepEqual(
    [cafeFlow.totals.income, cafeFlow.totals.expenses],
    ['0.00', '470.00'],
    'rent 400 + food 100 - refund 30 under one merchant',
  );
  assert.deepEqual(
    cafeFlow.series.map((p: any) => [p.start, p.expenses]),
    [
      ['2026-01-01', '500.00'],
      ['2026-02-01', '-30.00'],
      ['2026-03-01', '0.00'],
    ],
  );
  const cafeSpend = (
    await request('/reports/categories?type=expense&' + q + '&merchant=corner%20cafe')
  ).data;
  assert.deepEqual([cafeSpend.summary.count, cafeSpend.total], [3, '470.00']);
  assert.equal(
    (await request('/reports/cash-flow?' + q + '&merchant=nobody')).data.totals.expenses,
    '0.00',
  );
  assert.equal((await request('/reports/cash-flow?merchant=')).status, 400);

  for (const bad of [
    'from=2026-03-01&to=2026-01-01',
    'from=nope',
    'categories=abc',
    'interval=week',
    'breakdownFrom=2026-05-01&breakdownTo=2026-04-01',
  ])
    assert.equal((await request('/reports/cash-flow?' + bad)).status, 400, bad);
  assert.equal((await request('/reports/categories?type=transfer')).status, 400);
  await pool.query("DELETE FROM accounts WHERE id IN ('rpt:a','rpt:fx')");
}
{
  // Investment cash flow, live from the Reports lines: income minus spending on the included accounts, per day.
  await pool.query("DELETE FROM accounts WHERE id LIKE 'flow:%'");
  for (const [id, kind, currency, included] of [
    ['flow:bank', 'cash', 'USD', true],
    ['flow:card', 'credit', 'USD', true],
    ['flow:ignored', 'cash', 'USD', false],
    ['flow:euro', 'cash', 'EUR', true],
  ] as const)
    await pool.query(
      "INSERT INTO accounts(id,name,institution,kind,currency,source,included) VALUES($1,$1,'Test',$2,$3,'simulated',$4)",
      [id, kind, currency, included],
    );
  const addFlow = (
    id: string,
    account: string,
    date: string,
    amount: number,
    key: string,
    extra: { pending?: boolean; currency?: string } = {},
  ) =>
    pool.query(
      `INSERT INTO transactions(id,account_id,source,date,amount,currency,name,auto_category_key,provenance,pending)
       VALUES($1,$2,'plaid',$3,$4,$5,$1,$6,'simulated',$7)`,
      ['flow-' + id, account, date, amount, extra.currency ?? 'USD', key, extra.pending ?? false],
    );
  await addFlow('pay', 'flow:bank', '2031-01-05', -3000, 'paychecks'); // income: +3000
  await addFlow('bonus', 'flow:bank', '2031-01-05', -500, 'paychecks'); // the same day adds up
  await addFlow('rent', 'flow:bank', '2031-01-06', 1200, 'rent'); // spending: -1200
  await addFlow('refund', 'flow:card', '2031-01-06', -50, 'groceries'); // a refund reduces spending: +50
  await addFlow('stranger', 'flow:ignored', '2031-01-07', -9999, 'paychecks'); // account not included
  await addFlow('cardpay', 'flow:bank', '2031-01-08', 700, 'credit_card_payment'); // a transfer: left out
  await addFlow('to-broker', 'flow:bank', '2031-01-08', 5000, 'transfer'); // a transfer: left out
  await addFlow('pending', 'flow:bank', '2031-01-09', 800, 'groceries', { pending: true }); // not posted
  await addFlow('euro', 'flow:euro', '2031-01-10', 400, 'groceries', { currency: 'EUR' }); // not USD
  await addFlow('uncat-in', 'flow:bank', '2031-01-11', -20, 'uncategorized'); // by direction: income
  await addFlow('uncat-out', 'flow:bank', '2031-01-12', 15, 'uncategorized'); // by direction: expense
  const read = async () =>
    (await request('/investments/cash-flows')).data.flows
      .filter((f: any) => f.date >= '2031-01-01' && f.date < '2031-02-01')
      .map((f: any) => [f.date, Number(f.amount)]);
  assert.deepEqual(await read(), [
    ['2031-01-05', 3500],
    ['2031-01-06', -1150],
    ['2031-01-11', 20],
    ['2031-01-12', -15],
  ]);
  // Nothing is stored: editing a transaction changes the next answer. Recategorise the rent as a transfer.
  await pool.query("UPDATE transactions SET auto_category_key='transfer' WHERE id='flow-rent'");
  assert.deepEqual((await read())[1], ['2031-01-06', 50]);
  // The day cash flows are counted from: the first day of the month of the earliest bank transaction.
  await pool.query(
    "INSERT INTO accounts(id,name,institution,kind,currency,source,included) VALUES('flow:early','flow:early','Test','cash','USD','simulated',true)",
  );
  await addFlow('earliest', 'flow:early', '2000-03-15', 10, 'groceries');
  const info = async () => (await request('/investments/cash-flows')).data;
  assert.deepEqual(
    [(await info()).auto_from, (await info()).from, (await info()).override],
    ['2000-03-01', '2000-03-01', null],
  );
  // The start is the first day of the month the earliest transaction is in, whatever its day.
  await addFlow('earliest-first', 'flow:early', '2000-03-01', 10, 'groceries');
  assert.deepEqual([(await info()).auto_from, (await info()).from], ['2000-03-01', '2000-03-01']);
  await pool.query("DELETE FROM transactions WHERE id='flow-earliest-first'");
  assert.equal((await info()).auto_from, '2000-03-01');
  // Once the earliest transaction is gone the next one decides: a 15 April one starts on 1 April.
  await addFlow('earliest-april', 'flow:early', '2000-04-15', 10, 'groceries');
  await pool.query("DELETE FROM transactions WHERE id='flow-earliest'");
  assert.equal((await info()).auto_from, '2000-04-01');
  await pool.query("DELETE FROM transactions WHERE id='flow-earliest-april'");
  await addFlow('earliest', 'flow:early', '2000-03-15', 10, 'groceries');
  // A date you choose wins, and going back to automatic removes it. Bad dates are refused.
  assert.equal(
    (await request('/investments/cash-flows-from', { date: '2026-01-01' }, 'PUT')).status,
    200,
  );
  assert.deepEqual(
    [(await info()).auto_from, (await info()).from, (await info()).override],
    ['2000-03-01', '2026-01-01', '2026-01-01'],
  );
  const dayFromNow = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  // A day in the future leaves no span to calculate, so it is refused; today and tomorrow (time zones) are fine.
  assert.equal(
    (await request('/investments/cash-flows-from', { date: dayFromNow(30) }, 'PUT')).status,
    400,
  );
  assert.equal(
    (await request('/investments/cash-flows-from', { date: dayFromNow(1) }, 'PUT')).status,
    200,
  );
  assert.equal((await info()).override, dayFromNow(1));
  assert.equal((await request('/investments/cash-flows-from', { date: null }, 'PUT')).status, 200);
  for (const bad of [{ date: '2026-13-01' }, { date: 'nope' }, { date: 5 }, {}])
    assert.equal(
      (await request('/investments/cash-flows-from', bad, 'PUT')).status,
      400,
      JSON.stringify(bad),
    );
  assert.equal((await request('/investments/cash-flows-from', { date: null }, 'PUT')).status, 200);
  assert.equal((await info()).from, '2000-03-01');
  await pool.query("DELETE FROM accounts WHERE id LIKE 'flow:%'");
}
// Reconnect with an account un-selected: it is excluded once, kept, and restored if it comes back.
{
  await pool.query("DELETE FROM connections WHERE id='unret'");
  await pool.query(
    "INSERT INTO connections(id,institution,token,products,environment) VALUES('unret','Test','',$1,$2)",
    ['[]', config.plaidEnv],
  );
  for (const p of ['a', 'b'])
    await pool.query(
      "INSERT INTO accounts(id,connection_id,provider_id,name,institution,kind,currency,source,included) VALUES($1,'unret',$2,$1,'Test','cash','USD','simulated',true)",
      ['unret:' + p, p],
    );
  const included = async (p: string) =>
    (await pool.query('SELECT included,last_error FROM accounts WHERE id=$1', ['unret:' + p]))
      .rows[0];
  await excludeUnreturnedAccounts(pool, 'unret', ['a']);
  assert.deepEqual(await included('a'), { included: true, last_error: null });
  assert.deepEqual(await included('b'), { included: false, last_error: 'ACCOUNT_NOT_RETURNED' });
  // The user re-includes it while Plaid still does not return it: the next sync does not fight that.
  await pool.query("UPDATE accounts SET included=true WHERE id='unret:b'");
  await excludeUnreturnedAccounts(pool, 'unret', ['a']);
  assert.equal((await included('b')).included, true);
  await pool.query("DELETE FROM accounts WHERE id LIKE 'unret:%'");
  await pool.query("DELETE FROM connections WHERE id='unret'");
}
// Holdings typed in by hand: only where the provider gives none, shown in the overview, never doubled by synced ones.
{
  const put = (id: string, holdings: unknown) =>
    request('/accounts/' + encodeURIComponent(id) + '/holdings', { holdings }, 'PUT');
  const line = {
    symbol: 'voo',
    name: 'Vanguard S&P 500',
    asset_class: 'Equities',
    quantity: '2.5',
    price: '100',
  };
  const mine = async (id: string) =>
    ((await request('/overview')).data.holdings as any[]).filter((h) => h.account_id === id);
  await pool.query("DELETE FROM accounts WHERE id LIKE 'mh:%'");
  for (const [id, kind, source, asOf] of [
    ['mh:manual', 'investment', 'manual', null],
    ['mh:cash', 'cash', 'manual', null],
    ['mh:synced', 'investment', 'plaid_sandbox', '2031-02-03'],
    ['mh:nosync', 'investment', 'plaid_sandbox', '2031-02-03'],
  ])
    await pool.query(
      "INSERT INTO accounts(id,name,institution,kind,currency,source,holdings_as_of) VALUES($1,$1,'Test',$2,'USD',$3,$4)",
      [id, kind, source, asOf],
    );
  await pool.query(
    "INSERT INTO securities(id,symbol,name,asset_class) VALUES('mh:sec','SYN','Synced','Equities') ON CONFLICT DO NOTHING",
  );
  await pool.query(
    "INSERT INTO holding_snapshots(account_id,security_id,date,quantity,price,value,provenance) VALUES('mh:synced','mh:sec','2031-02-03',1,1,1,'plaid_sandbox')",
  );
  // validation and the rule about who may be edited
  assert.equal((await put('mh:manual', [{ ...line, quantity: '0' }])).status, 400);
  assert.equal((await put('mh:cash', [line])).status, 400, 'not an investment account');
  assert.equal((await put('mh:synced', [line])).status, 400, 'the bank supplies holdings');
  assert.equal((await put('nope', [line])).status, 400, 'unknown account');
  assert.equal((await mine('mh:synced')).length, 1);
  // a manual account keeps what you type, valued at shares x price
  assert.equal((await put('mh:manual', [line])).status, 200);
  const [m] = await mine('mh:manual');
  assert.equal(m.provenance, 'manual');
  assert.equal(m.symbol, 'VOO');
  assert.equal(Number(m.value), 250);
  assert.equal(m.cost_basis, null);
  // replacing the list replaces it, and an empty list clears it
  assert.equal(
    (
      await put('mh:manual', [
        line,
        { ...line, symbol: 'BND', name: 'Bonds', asset_class: 'Bonds' },
      ])
    ).status,
    200,
  );
  assert.equal((await mine('mh:manual')).length, 2);
  assert.equal((await put('mh:manual', [])).status, 200);
  assert.equal((await mine('mh:manual')).length, 0);
  // a synced brokerage with nothing on its latest day: shown on that day, hidden once the bank supplies holdings
  assert.equal((await put('mh:nosync', [line])).status, 200);
  const [n] = await mine('mh:nosync');
  assert.equal(n.date, '2031-02-03');
  assert.equal(n.provenance, 'manual');
  await pool.query(
    "INSERT INTO holding_snapshots(account_id,security_id,date,quantity,price,value,provenance) VALUES('mh:nosync','mh:sec','2031-02-03',1,1,1,'plaid_sandbox')",
  );
  const after = await mine('mh:nosync');
  assert.deepEqual(
    after.map((h) => h.provenance),
    ['plaid_sandbox'],
    'synced holdings replace typed-in ones',
  );
  assert.equal((await put('mh:nosync', [line])).status, 400, 'no longer editable');
  await pool.query("DELETE FROM accounts WHERE id LIKE 'mh:%'");
  await pool.query("DELETE FROM securities WHERE id='mh:sec'");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM manual_holdings WHERE account_id LIKE 'mh:%'",
      )
    ).rows[0].n,
    0,
    'deleted with the account',
  );
}
// Ticker prices: the held tickers of real accounts are downloaded, a failure keeps what is stored, the demo is never priced.
{
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const stamp = (offset: number) => Math.floor(Date.now() / 86400000 + offset) * 86400 + 43200;
  const asked: string[] = [];
  let boom = false;
  const fakeFetch = (async (url: string) => {
    const symbol = decodeURIComponent(String(url).split('/chart/')[1].split('?')[0]);
    asked.push(symbol);
    if (symbol === 'BADONE' || boom) return { ok: false, status: 500, json: async () => ({}) };
    const base = symbol === 'VOO' ? 400 : 10;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        chart: {
          result: [
            {
              meta: { gmtoffset: 0 },
              timestamp: [stamp(-2), stamp(-1)],
              indicators: { quote: [{ close: [base, base + 1] }] },
            },
          ],
        },
      }),
    };
  }) as unknown as typeof fetch;
  await pool.query(
    "DELETE FROM security_prices WHERE symbol IN ('VOO','BRK.B','BADONE','TYPED','DEMOONLY')",
  );
  await pool.query("DELETE FROM accounts WHERE id LIKE 'px:%'");
  for (const [id, source] of [
    ['px:real', 'plaid_sandbox'],
    ['px:demo', 'simulated'],
    ['px:hand', 'manual'],
  ])
    await pool.query(
      "INSERT INTO accounts(id,name,institution,kind,currency,source) VALUES($1,$1,'Test','investment','USD',$2)",
      [id, source],
    );
  await pool.query(
    "INSERT INTO balance_snapshots(account_id,date,current_balance,provenance) VALUES('px:real','2000-01-01',1,'manual')",
  );
  for (const [id, symbol] of [
    ['px:voo', 'VOO'],
    ['px:brk', 'BRK.B'],
    ['px:bad', 'BADONE'],
    ['px:demo', 'DEMOONLY'],
    ['px:cur', 'CUR:USD'],
    ['px:old', 'OLDONE'],
  ])
    await pool.query(
      "INSERT INTO securities(id,symbol,name,asset_class) VALUES($1,$2,$2,'Equities') ON CONFLICT(id) DO UPDATE SET symbol=excluded.symbol",
      [id, symbol],
    );
  const snap = (account: string, security: string, date: string) =>
    pool.query(
      "INSERT INTO holding_snapshots(account_id,security_id,date,quantity,price,value,provenance) VALUES($1,$2,$3,1,1,1,'x')",
      [account, security, date],
    );
  for (const sec of ['px:voo', 'px:brk', 'px:bad', 'px:cur']) await snap('px:real', sec, day(0));
  await snap('px:real', 'px:old', day(-60)); // no longer held
  await snap('px:demo', 'px:demo', day(0));
  await pool.query(
    "INSERT INTO manual_holdings(account_id,symbol,name,asset_class,quantity,price) VALUES('px:hand','typed','Typed in','Equities',1,1)",
  );
  // an old row inside the window is replaced; one before it is not touched; a failing ticker keeps its row
  await pool.query(
    "INSERT INTO security_prices(symbol,date,close) VALUES('VOO',$1,1),('BADONE',$1,7)",
    [day(-2)],
  );
  await pool.query("INSERT INTO security_prices(symbol,date,close) VALUES('VOO','1999-01-04',3)");

  const first = await refreshSecurityPrices(fakeFetch);
  assert.deepEqual(
    [...asked].sort(),
    ['BADONE', 'BRK-B', 'TYPED', 'VOO'],
    'real and typed-in tickers only',
  );
  assert.deepEqual(first.updated.sort(), ['BRK.B', 'TYPED', 'VOO']);
  assert.deepEqual(first.failed, ['BADONE']);
  const stored = async (symbol: string) =>
    (
      await pool.query(
        'SELECT date::text AS date, close::float AS close FROM security_prices WHERE symbol=$1 ORDER BY date',
        [symbol],
      )
    ).rows;
  assert.deepEqual(await stored('VOO'), [
    { date: '1999-01-04', close: 3 },
    { date: day(-2), close: 400 },
    { date: day(-1), close: 401 },
  ]);
  assert.equal((await stored('BRK.B')).length, 2, 'stored under the ticker as held');
  assert.deepEqual(
    await stored('BADONE'),
    [{ date: day(-2), close: 7 }],
    'a failed download keeps its rows',
  );
  assert.equal((await stored('DEMOONLY')).length, 0);
  // a second run is the same, and a whole outage changes nothing
  await refreshSecurityPrices(fakeFetch);
  assert.equal((await stored('VOO')).length, 3);
  boom = true;
  const outage = await refreshSecurityPrices(fakeFetch);
  assert.equal(outage.updated.length, 0);
  assert.equal((await stored('VOO')).length, 3);
  // the overview carries them
  const sent = ((await request('/overview')).data.prices as any[]).filter(
    (p) => p.symbol === 'VOO',
  );
  assert.deepEqual(
    sent.map((p) => p.date),
    ['1999-01-04', day(-2), day(-1)],
  );
  await pool.query("DELETE FROM security_prices WHERE symbol IN ('VOO','BRK.B','BADONE','TYPED')");
  await pool.query("DELETE FROM accounts WHERE id LIKE 'px:%'");
  await pool.query("DELETE FROM securities WHERE id LIKE 'px:%'");
}
// A real investment account's balance, with its holdings valued at the latest closes.
{
  const nw = async () =>
    Number(
      (
        await pool.query(
          'SELECT net_worth::float AS n FROM daily_net_worth WHERE date=CURRENT_DATE',
        )
      ).rows[0].n,
    );
  const bal = async (id: string) =>
    (
      await pool.query(
        'SELECT current_balance::float AS b, holdings_adjustment::float AS a FROM balance_snapshots WHERE account_id=$1 AND date=CURRENT_DATE',
        [id],
      )
    ).rows[0];
  await pool.query("DELETE FROM security_prices WHERE symbol LIKE 'AP%'");
  await pool.query("DELETE FROM accounts WHERE id LIKE 'ap:%'");
  await pool.query("DELETE FROM securities WHERE id LIKE 'ap:%'");
  for (const [id, source] of [
    ['ap:prod', 'plaid_production'],
    ['ap:sand', 'plaid_sandbox'],
    ['ap:hand', 'manual'],
  ]) {
    await pool.query(
      "INSERT INTO accounts(id,name,institution,kind,currency,source,holdings_as_of) VALUES($1,$1,'Test','investment','USD',$2,CURRENT_DATE)",
      [id, source],
    );
    await pool.query(
      "INSERT INTO balance_snapshots(account_id,date,current_balance,provenance) VALUES($1,CURRENT_DATE,5000,'x')",
      [id],
    );
  }
  for (const [id, symbol] of [
    ['ap:s1', 'APONE'],
    ['ap:s2', 'APTWO'],
    ['ap:s3', 'APTHREE'],
    ['ap:s4', 'APFOUR'],
  ])
    await pool.query(
      "INSERT INTO securities(id,symbol,name,asset_class) VALUES($1,$2,$2,'Equities')",
      [id, symbol],
    );
  for (const acc of ['ap:prod', 'ap:sand', 'ap:hand'])
    for (const [sec, qty] of [
      ['ap:s1', 10],
      ['ap:s2', 5],
      ['ap:s3', 1],
      ['ap:s4', 1],
    ])
      await pool.query(
        "INSERT INTO holding_snapshots(account_id,security_id,date,quantity,price,value,provenance) VALUES($1,$2,CURRENT_DATE,$3::numeric,100,$3::numeric*100,'x')",
        [acc, sec, qty],
      );
  const close = (symbol: string, daysAgo: number, c: number) =>
    pool.query(
      'INSERT INTO security_prices(symbol,date,close) VALUES($1,CURRENT_DATE-$2::int,$3) ON CONFLICT(symbol,date) DO UPDATE SET close=excluded.close',
      [symbol, daysAgo, c],
    );
  await close('APONE', 0, 110); // +10 x 10 = +100
  await close('APTWO', 0, 300); // three times the bank's price: ignored
  await close('APFOUR', 10, 150); // ten days old: ignored
  // APTHREE has no close at all
  {
    const c = await pool.connect();
    await c.query('BEGIN');
    await recompute(c);
    await c.query('COMMIT');
    c.release();
  }
  const before = await nw();

  assert.equal(await applyHoldingPrices(), 1, 'only the real account');
  assert.deepEqual(await bal('ap:prod'), { b: 5100, a: 100 });
  assert.deepEqual(await bal('ap:sand'), { b: 5000, a: 0 }, 'sandbox untouched');
  assert.deepEqual(await bal('ap:hand'), { b: 5000, a: 0 }, 'manual untouched');
  assert.equal((await nw()) - before, 100, 'net worth follows');
  assert.equal(
    Number(
      ((await request('/overview')).data.accounts as any[]).find((a) => a.id === 'ap:prod')
        .balance_adjustment,
    ),
    100,
  );
  // running it again changes nothing
  assert.equal(await applyHoldingPrices(), 1);
  assert.deepEqual(await bal('ap:prod'), { b: 5100, a: 100 });
  // a new close moves it from the bank's balance, not from the last result
  await close('APONE', 0, 120);
  await applyHoldingPrices();
  assert.deepEqual(await bal('ap:prod'), { b: 5200, a: 200 });
  // a sync writes the bank's balance with no adjustment, then the price step applies it again
  await pool.query(
    "UPDATE balance_snapshots SET current_balance=5050, holdings_adjustment=0 WHERE account_id='ap:prod' AND date=CURRENT_DATE",
  );
  await applyHoldingPrices();
  assert.deepEqual(await bal('ap:prod'), { b: 5250, a: 200 });
  // no prices at all (an outage) leaves what the sync wrote
  await pool.query(
    "UPDATE balance_snapshots SET current_balance=5050, holdings_adjustment=0 WHERE account_id='ap:prod' AND date=CURRENT_DATE",
  );
  await pool.query("DELETE FROM security_prices WHERE symbol LIKE 'AP%'");
  assert.equal(await applyHoldingPrices(), 0);
  assert.deepEqual(await bal('ap:prod'), { b: 5050, a: 0 });
  await pool.query("DELETE FROM accounts WHERE id LIKE 'ap:%'");
  await pool.query("DELETE FROM securities WHERE id LIKE 'ap:%'");
}
{
  // The sync schedule: the deployment's default until one is saved, validated on save, and a reset goes back.
  const get = async () => (await request('/sync/schedule')).data;
  const first = await get();
  assert.deepEqual([first.source, first.enabled, first.cron], ['default', true, config.syncCron]);
  const mine = { enabled: false, time: '06:30', timezone: 'Europe/Berlin' };
  const weekly = {
    enabled: true,
    frequency: 'weekly',
    weekday: 5,
    time: '08:00',
    timezone: 'Europe/Berlin',
  };
  assert.equal((await request('/sync/schedule', weekly, 'PUT')).data.cron, '0 8 * * 5');
  const monthly = {
    enabled: true,
    frequency: 'monthly',
    day: 15,
    time: '08:00',
    timezone: 'Europe/Berlin',
  };
  assert.equal((await request('/sync/schedule', monthly, 'PUT')).data.cron, '0 8 15 * *');
  const saved = await request('/sync/schedule', mine, 'PUT');
  assert.equal(saved.status, 200);
  assert.deepEqual(
    [saved.data.source, saved.data.enabled, saved.data.cron, saved.data.timezone],
    ['settings', false, '30 6 * * *', 'Europe/Berlin'],
  );
  assert.deepEqual(await get(), saved.data);
  for (const bad of [
    { ...mine, time: '25:00' },
    { ...mine, timezone: 'Mars/Base' },
    { ...mine, frequency: 'monthly', day: 31 },
    {},
  ])
    assert.equal((await request('/sync/schedule', bad, 'PUT')).status, 400, JSON.stringify(bad));
  assert.equal((await get()).cron, '30 6 * * *'); // a refused save changes nothing
  assert.equal((await request('/sync/schedule', { reset: true }, 'PUT')).data.source, 'default');
  assert.deepEqual(await get(), first);
}
// --- Rules: your edit, then a rule, then the automatic category ---
{
  const cats = (await request('/categories')).data.categories;
  const catId = (key: string) => Number(cats.find((c: any) => c.key === key).id);
  const dining = catId('restaurants');
  const shopping = catId('shopping');
  await pool.query("DELETE FROM accounts WHERE id='itest:acct'");
  await pool.query(
    "INSERT INTO accounts(id,name,institution,kind,source) VALUES('itest:acct','Sync test','Test','cash','manual')",
  );
  await sync({ added: [plaidTxn('r1', { name: 'RULE TEST CAFE', amount: 12.5 })] }, 'rc1');
  const one = async () =>
    (await request('/transactions?limit=500&account=itest:acct')).data.transactions.find(
      (t: any) => t.id === 'itest:r1',
    );
  const before = await one();
  const text = { merchant: { op: 'contains', values: ['rule test'] } };
  for (const bad of [
    {},
    { conditions: {}, category_id: dining },
    { conditions: text, category_id: 999999 },
    { conditions: { ...text, accounts: ['nope'] }, category_id: dining },
  ])
    assert.equal((await request('/rules', bad)).status, 400, JSON.stringify(bad));

  // Preview writes nothing and says what would change.
  const shown = (await request('/rules/preview', { conditions: text, category_id: dining })).data;
  assert.ok(shown.matching >= 1 && shown.changes.some((c: any) => c.id === 'itest:r1'));
  assert.equal((await one()).category_source, before.category_source, 'a preview changes nothing');

  // Saving without "update existing" leaves existing rows alone; applying updates exactly the previewed set.
  const r1 = (await request('/rules', { conditions: text, category_id: dining, apply: false }))
    .data;
  assert.equal(r1.updated, null);
  assert.equal((await one()).category_source, before.category_source);
  const applied = (await request('/rules/' + r1.rule.id + '/apply', {})).data;
  assert.equal(applied.updated, shown.total);
  const ruled = await one();
  assert.equal(ruled.category_source, 'rule');
  assert.equal(ruled.category.id, dining);
  assert.equal(
    (await request('/rules')).data.rules.find((r: any) => r.id === r1.rule.id).last_applied_count,
    applied.updated,
  );

  // Your own choice beats the rule, and clearing it brings the rule back.
  await request('/transactions/itest%3Ar1', { category_id: shopping }, 'PATCH');
  assert.equal((await one()).category_source, 'user');
  assert.equal((await request('/rules/' + r1.rule.id + '/apply', {})).data.updated, 0);
  assert.equal((await one()).category.id, shopping, 'a rule never overwrites your choice');
  await request('/transactions/itest%3Ar1', { category_id: null }, 'PATCH');
  assert.equal((await one()).category.id, dining);

  // A later rule wins; moving it up lets the first win again; a rule's category cannot be deleted.
  const r2 = (await request('/rules', { conditions: text, category_id: shopping, apply: true }))
    .data;
  assert.equal((await one()).category.id, shopping);
  assert.equal(
    (await request('/rules/order', { ids: [r2.rule.id, r1.rule.id] })).data.rules[0].id,
    r2.rule.id,
  );
  assert.equal((await request('/rules/order', { ids: [r2.rule.id] })).status, 400);
  await request('/rules/' + r1.rule.id + '/apply', {});
  assert.equal((await one()).category.id, dining, 'the last rule in the list wins');
  assert.equal((await request('/categories/' + dining, undefined, 'DELETE')).status, 400);

  // Reports and category counts follow the rule.
  const counted = (await request('/categories')).data.categories.find((c: any) => c.id === dining);
  assert.ok(counted.transaction_count >= 1);

  // A sync gives new and changed rows their rule result, and skips split ones.
  await sync({ added: [plaidTxn('r2', { name: 'RULE TEST DINER', amount: 8 })] }, 'rc2');
  const synced = (
    await request('/transactions?limit=500&account=itest:acct')
  ).data.transactions.find((t: any) => t.id === 'itest:r2');
  assert.equal(synced.category.id, dining);
  assert.equal(synced.category_source, 'rule');
  await sync({ modified: [plaidTxn('r2', { name: 'OTHER SHOP', amount: 8 })] }, 'rc3');
  const renamed = (
    await request('/transactions?limit=500&account=itest:acct')
  ).data.transactions.find((t: any) => t.id === 'itest:r2');
  assert.notEqual(
    renamed.category_source,
    'rule',
    'a row that stops matching loses the rule result',
  );

  // Deleting a rule can put its transactions back.
  assert.equal(
    (await request('/rules/' + r2.rule.id + '?revert=true', undefined, 'DELETE')).status,
    200,
  );
  assert.equal(
    (await request('/rules/' + r1.rule.id + '?revert=true', undefined, 'DELETE')).data.reverted >=
      1,
    true,
  );
  assert.equal((await one()).category_source, before.category_source);
  assert.equal((await request('/rules/' + r1.rule.id, undefined, 'DELETE')).status, 404);
  await pool.query("DELETE FROM accounts WHERE id='itest:acct'");
}

// --- Brokerage activity: listed unless the Transactions page hides it, counted only once categorised ---
{
  await pool.query("DELETE FROM accounts WHERE id IN ('itest:broker','itest:401k')");
  await pool.query(
    "INSERT INTO accounts(id,name,institution,kind,source) VALUES('itest:broker','Brokerage test','Test','investment','manual'),('itest:401k','401k test','Test','investment','manual')",
  );
  const cats = (await request('/categories')).data.categories;
  const catId = (key: string) => Number(cats.find((c: any) => c.key === key).id);
  const dividends = catId('dividends_gains');
  const range = 'from=2025-05-01&to=2025-05-31';
  const totals = async () => (await request('/reports/cash-flow?' + range)).data.totals;
  const flows = async () => (await request('/investments/cash-flows')).data.flows;
  const count = async (id: number) =>
    (await request('/categories')).data.categories.find((c: any) => c.id === id).transaction_count;
  const list = async (extra = '') =>
    (await request(`/transactions?limit=500&${range}${extra}`)).data.transactions as any[];

  // A transaction you add to an investment account counts in Reports, hidden from the list or not.
  const start = await totals();
  const manual = (
    await request('/transactions', {
      account_id: 'itest:401k',
      date: '2025-05-10',
      amount: '300',
      direction: 'in',
      name: '401k match',
      category_id: catId('other_income'),
    })
  ).data;
  assert.equal(manual.account_kind, 'investment');
  const before = {
    totals: await totals(),
    flows: await flows(),
    dividends: await count(dividends),
  };
  assert.equal(Number(before.totals.income) - Number(start.income), 300);

  const window = { from: '2025-05-01', to: '2025-05-31', complete: true };
  const inv = (id: string, extra: any) => ({
    investment_transaction_id: id,
    account_id: 'broker',
    security_id: 'sec',
    date: '2025-05-12',
    name: id.toUpperCase(),
    quantity: 0,
    amount: 0,
    price: null,
    fees: null,
    type: 'cash',
    subtype: null,
    iso_currency_code: 'USD',
    ...extra,
  });
  const page = {
    transactions: [
      inv('buy', { type: 'buy', subtype: 'buy', quantity: 10, amount: 1000, price: 100, fees: 0 }),
      inv('deposit', { security_id: null, subtype: 'deposit', amount: -2000, date: '2025-05-11' }),
      inv('div', { subtype: 'dividend', amount: -42.5, date: '2025-05-20' }),
      inv('move', { type: 'transfer', subtype: 'transfer', quantity: 3, date: '2025-05-21' }),
    ],
    securities: [
      { security_id: 'sec', ticker_symbol: 'ITST', name: 'Integration fund', type: 'etf' },
    ],
  };
  const accountsMap = new Map([['broker', 'itest:broker']]);
  const plan = (pages: any[], w = window) =>
    planInvestmentChanges('itest', pages, accountsMap, 'plaid_sandbox', w, []);
  await applyInvestmentChanges('itest', plan([page]), false);

  // Uncategorised brokerage activity counts nowhere.
  assert.deepEqual(
    await totals(),
    before.totals,
    'a buy, a deposit or a dividend alone changes no report',
  );
  assert.deepEqual(await flows(), before.flows);
  assert.equal(await count(dividends), before.dividends);

  // Listed by default, hidden with investments=hide (manual rows on investment accounts too).
  const all = await list();
  for (const id of ['itest:buy', 'itest:deposit', 'itest:div', 'itest:move', manual.id])
    assert.ok(
      all.some((t) => t.id === id),
      id,
    );
  assert.ok(!(await list('&investments=hide')).some((t) => t.account_kind === 'investment'));
  assert.equal((await request('/transactions?investments=show')).status, 400);
  const buy = all.find((t) => t.id === 'itest:buy');
  assert.equal(buy.activity, 'investment');
  assert.equal(buy.category, null);
  assert.equal(buy.category_source, 'none');
  assert.deepEqual(
    [
      buy.investment.type,
      buy.investment.quantity,
      buy.investment.price,
      buy.investment.security.symbol,
    ],
    ['buy', '10', '100', 'ITST'],
  );
  assert.equal(all.find((t) => t.id === manual.id).activity, 'bank');
  assert.ok(
    (await list('&q=itst')).some((t) => t.id === 'itest:buy'),
    'found by security symbol',
  );
  assert.ok(!(await list('&merchant=DIV')).some((t) => t.activity === 'investment'));
  assert.ok(
    !(await list('&type=income')).some((t) => t.id === 'itest:div'),
    'not income until categorised',
  );

  // Paging across bank and brokerage rows returns every row once.
  const seen: string[] = [];
  for (let cursor = ''; ;) {
    const r = (await request(`/transactions?limit=2&${range}${cursor ? '&cursor=' + cursor : ''}`))
      .data;
    seen.push(...r.transactions.map((t: any) => t.id));
    if (!r.nextCursor) break;
    cursor = r.nextCursor;
  }
  assert.deepEqual(
    seen,
    all.map((t) => t.id),
  );
  assert.equal(new Set(seen).size, seen.length);

  // Only the category and notes can change.
  const div = 'itest%3Adiv';
  assert.equal(
    (await request('/transactions/' + div, { date: '2025-05-01' }, 'PATCH')).status,
    409,
  );
  assert.equal((await request('/transactions/' + div, undefined, 'DELETE')).status, 409);
  assert.equal(
    (await request('/transactions/' + div + '/splits', { splits: [] }, 'PUT')).status,
    409,
  );
  assert.equal(
    (await request('/transactions/' + div, { category_id: 999999 }, 'PATCH')).status,
    400,
  );
  const categorised = (
    await request('/transactions/' + div, { category_id: dividends, notes: 'reinvested' }, 'PATCH')
  ).data;
  assert.equal(categorised.category.id, dividends);
  assert.equal(categorised.category_source, 'user');
  assert.equal(categorised.notes, 'reinvested');

  // Categorised, it counts in Reports like any income, but never as money added to the investments.
  const counted = await totals();
  assert.equal(Number(counted.income) - Number(before.totals.income), 42.5);
  assert.deepEqual(await flows(), before.flows, 'a dividend inside a brokerage is not a cash flow');
  assert.equal(await count(dividends), before.dividends + 1);
  assert.ok((await list('&categories=' + dividends)).some((t) => t.id === 'itest:div'));
  assert.ok((await list('&type=income')).some((t) => t.id === 'itest:div'));
  assert.ok(!(await list('&type=expense')).some((t) => t.id === 'itest:buy'));

  // A sync keeps the owner's category and notes.
  await applyInvestmentChanges('itest', plan([page]), false);
  const kept = (await list()).find((t) => t.id === 'itest:div');
  assert.deepEqual([kept.category.id, kept.notes], [dividends, 'reinvested']);

  // Rows Plaid no longer returns in a fully read window disappear, and come back if it sends them again.
  await applyInvestmentChanges(
    'itest',
    planInvestmentChanges(
      'itest',
      [{ transactions: [page.transactions[0]], securities: [] }],
      accountsMap,
      'p',
      window,
      (await list())
        .filter((t) => t.activity === 'investment')
        .map((t) => ({ id: t.id, date: t.date })),
    ),
    false,
  );
  assert.deepEqual(
    (await list()).filter((t) => t.activity === 'investment').map((t) => t.id),
    ['itest:buy'],
  );
  assert.equal(
    Number((await totals()).income),
    Number(before.totals.income),
    'a removed dividend stops counting',
  );
  await applyInvestmentChanges('itest', plan([page]), false);
  assert.equal((await list()).find((t) => t.id === 'itest:div').category.id, dividends);

  // Back to "Not counted", and a deleted category leaves the row not counted.
  await request('/transactions/' + div, { category_id: null }, 'PATCH');
  assert.deepEqual(await totals(), before.totals);
  const temp = (
    await request('/categories', {
      name: 'Integration activity',
      group_id: cats.find((c: any) => c.key === 'other_income').group_id,
    })
  ).data;
  await request('/transactions/' + div, { category_id: temp.id }, 'PATCH');
  assert.equal((await request('/categories/' + temp.id, undefined, 'DELETE')).status, 200);
  assert.equal((await list()).find((t) => t.id === 'itest:div').category, null);

  await pool.query("DELETE FROM accounts WHERE id IN ('itest:broker','itest:401k')");
  await pool.query("DELETE FROM securities WHERE id='itest:sec'");
}

console.log(
  'PASS: transaction list, filters, paging, edits, sync keeps user edits, groups and categories, splits, manual transactions, monarch import, remap, reports, investment cash flows, typed-in holdings, ticker prices, balance priced at closes, sync schedule, rules, brokerage activity',
);

// --- First-run passphrase setup (the real settings table) ---
{
  const store = new DbAuthStore();
  await store.setPassphrase(null); // the passphrase created at the start of this test
  const [a, b] = await Promise.all([
    hashPassphrase('first long passphrase'),
    hashPassphrase('second long passphrase'),
  ]);
  const results = await Promise.all([store.createPassphrase(a), store.createPassphrase(b)]);
  assert.deepEqual(results.slice().sort(), [false, true], 'exactly one racing setup wins');
  const stored = await store.getPassphrase();
  assert.ok(stored && [a.hash, b.hash].includes(stored.hash));
  assert.equal(await store.createPassphrase(a === stored ? b : a), false, 'never overwrites');
  assert.deepEqual(await store.getPassphrase(), stored);
  await store.setPassphrase(null); // leave the database as it was
  console.log('PASS: first-run setup is atomic and never overwrites a passphrase');
}
await pool.end();
