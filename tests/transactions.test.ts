import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapProviderCategory,
  planTransactionChanges,
  type PlaidTransaction,
  type SyncPage,
} from '../server/lib/transactions.ts';
import { demoTransactions } from '../server/db/seed.ts';

const accounts = new Map([['acct-1', 'conn:acct-1']]);
const txn = (id: string, extra: Partial<PlaidTransaction> = {}): PlaidTransaction => ({
  transaction_id: id,
  account_id: 'acct-1',
  amount: 12.5,
  date: '2026-10-01',
  name: 'COFFEE SHOP',
  merchant_name: 'Coffee Shop',
  pending: false,
  ...extra,
});
const page = (p: Partial<SyncPage>): SyncPage => ({ added: [], modified: [], removed: [], ...p });
const plan = (pages: SyncPage[]) => planTransactionChanges('conn', pages, accounts, 'plaid_test');

test('detailed provider category wins over the primary one', () => {
  assert.equal(mapProviderCategory('FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES'), 'groceries');
  assert.equal(mapProviderCategory('FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE'), 'coffee_shops');
  assert.equal(mapProviderCategory('FOOD_AND_DRINK', 'FOOD_AND_DRINK_FAST_FOOD'), 'restaurants');
  assert.equal(mapProviderCategory('TRANSPORTATION', 'TRANSPORTATION_GAS'), 'gas_ev');
  assert.equal(mapProviderCategory('TRANSPORTATION', 'TRANSPORTATION_TOLLS'), 'parking_tolls');
  assert.equal(
    mapProviderCategory('TRANSPORTATION', 'TRANSPORTATION_BIKES_AND_SCOOTERS'),
    'transportation',
  );
  assert.equal(mapProviderCategory('RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_TELEPHONE'), 'phone');
  assert.equal(mapProviderCategory('TRANSFER_OUT', 'TRANSFER_OUT_ACCOUNT_TRANSFER'), 'transfer');
  assert.equal(mapProviderCategory('INCOME', 'INCOME_WAGES'), 'paychecks');
});

test('unknown or missing provider categories fall back to Uncategorized', () => {
  assert.equal(mapProviderCategory('SOMETHING_NEW', 'SOMETHING_NEW_X'), 'uncategorized');
  assert.equal(mapProviderCategory(null, null), 'uncategorized');
  assert.equal(mapProviderCategory(undefined, undefined, 'plain name'), 'uncategorized');
});

test('card autopay lines are card payments even when labelled as income', () => {
  assert.equal(
    mapProviderCategory('INCOME', 'INCOME_SALARY', 'AUTOMATIC PAYMENT - THANK'),
    'credit_card_payment',
  );
  assert.equal(
    mapProviderCategory('LOAN_PAYMENTS', null, 'CAPITAL ONE AUTOPAY PYMT'),
    'credit_card_payment',
  );
});

test('added and modified transactions become provider rows with namespaced ids', () => {
  const r = plan([
    page({
      added: [
        txn('a', {
          amount: -3200,
          personal_finance_category: { primary: 'INCOME', detailed: 'INCOME_WAGES' },
        }),
      ],
      modified: [txn('b', { pending: true, authorized_date: '2026-09-30' })],
    }),
  ]);
  assert.deepEqual(
    r.upserts.map((u) => u.id),
    ['conn:a', 'conn:b'],
  );
  const [a, b] = r.upserts;
  assert.equal(a.account_id, 'conn:acct-1');
  assert.equal(a.amount, '-3200');
  assert.equal(a.auto_category_key, 'paychecks');
  assert.equal(a.provenance, 'plaid_test');
  assert.equal(b.pending, true);
  assert.equal(b.authorized_date, '2026-09-30');
  assert.equal(b.currency, 'USD');
});

test('provider rows never carry user fields, so a sync cannot overwrite them', () => {
  const [row] = plan([page({ modified: [txn('a')] })]).upserts;
  for (const field of ['user_date', 'category_id', 'notes']) assert.ok(!(field in row));
});

test('transactions for accounts we do not track are skipped, not errors', () => {
  const r = plan([page({ added: [txn('a', { account_id: 'other' }), txn('b')] })]);
  assert.equal(r.upserts.length, 1);
  assert.equal(r.skipped, 1);
});

test('a pending row replaced by its posted row carries the user edits over and is removed', () => {
  const r = plan([
    page({
      added: [txn('posted', { pending_transaction_id: 'pend' })],
      removed: [{ transaction_id: 'pend' }],
    }),
  ]);
  assert.deepEqual(r.carryOver, [{ fromId: 'conn:pend', toId: 'conn:posted' }]);
  assert.deepEqual(r.removeIds, ['conn:pend']);
});

test('the pending row is removed even if the provider forgets to list it as removed', () => {
  const r = plan([page({ added: [txn('posted', { pending_transaction_id: 'pend' })] })]);
  assert.deepEqual(r.removeIds, ['conn:pend']);
});

test('removed transactions are marked for removal; a re-added one is not', () => {
  const r = plan([
    page({ removed: [{ transaction_id: 'gone' }, { transaction_id: 'back' }] }),
    page({ added: [txn('back')] }),
  ]);
  assert.deepEqual(r.removeIds, ['conn:gone']);
  assert.deepEqual(
    r.upserts.map((u) => u.id),
    ['conn:back'],
  );
});

test('the latest copy of a transaction across pages wins', () => {
  const r = plan([
    page({ added: [txn('a', { amount: 1 })] }),
    page({ modified: [txn('a', { amount: 2 })] }),
  ]);
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0].amount, '2');
});

test('missing names fall back to the merchant, then a placeholder', () => {
  const [a, b] = plan([
    page({
      added: [
        txn('a', { name: '', merchant_name: 'Shop' }),
        txn('b', { name: null, merchant_name: null }),
      ],
    }),
  ]).upserts;
  assert.equal(a.name, 'Shop');
  assert.equal(b.name, 'Unnamed transaction');
});

test('demo transactions are deterministic, recent and only use known categories', () => {
  const today = new Date('2026-10-03T12:00:00Z');
  const rows = demoTransactions(today);
  assert.deepEqual(rows, demoTransactions(today));
  assert.ok(rows.length > 100 && rows.length <= 160);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.ok(rows.every((r) => r.date <= '2026-10-03' && r.date >= '2026-06-01'));
  assert.ok(rows.some((r) => r.pending) && rows.some((r) => r.amount < 0));
});
