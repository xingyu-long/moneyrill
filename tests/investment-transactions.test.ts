import test from 'node:test';
import assert from 'node:assert/strict';
import { investmentLabel } from '../src/lib/transactions.ts';
import {
  assetClassOf,
  planInvestmentChanges,
  type PlaidInvestmentTransaction,
} from '../server/lib/investment-transactions.ts';

const accounts = new Map([['acct', 'local-acct']]);
const window = { from: '2026-09-01', to: '2026-10-20', complete: true };
const txn = (id: string, extra: Partial<PlaidInvestmentTransaction> = {}) => ({
  investment_transaction_id: id,
  account_id: 'acct',
  security_id: 'sec',
  date: '2026-10-01',
  name: 'BUY VOO',
  quantity: 10,
  amount: 5000,
  price: 500,
  fees: 0,
  type: 'buy',
  subtype: 'buy',
  iso_currency_code: 'USD',
  ...extra,
});
const sec = { security_id: 'sec', ticker_symbol: 'VOO', name: 'Vanguard S&P 500', type: 'etf' };
const plan = (
  txns: PlaidInvestmentTransaction[],
  saved: { id: string; date: string }[] = [],
  w = window,
) =>
  planInvestmentChanges(
    'c1',
    [{ transactions: txns, securities: [sec] }],
    accounts,
    'plaid_sandbox',
    w,
    saved,
  );

test('rows get prefixed ids, the Plaid sign and their security', () => {
  const r = plan([
    txn('t1'),
    txn('t2', { type: 'cash', subtype: 'dividend', amount: -42.5, quantity: 0 }),
  ]);
  assert.equal(r.upserts[0].id, 'c1:t1');
  assert.equal(r.upserts[0].account_id, 'local-acct');
  assert.equal(r.upserts[0].security_id, 'c1:sec');
  assert.equal(r.upserts[0].amount, '5000');
  assert.equal(r.upserts[1].amount, '-42.5');
  assert.deepEqual(
    r.securities.map((s) => [s.id, s.symbol, s.asset_class]),
    [['c1:sec', 'VOO', 'etf']],
  );
});

test('currency and name fall back, a row without a security has none', () => {
  const r = plan([
    txn('a', { iso_currency_code: null, unofficial_currency_code: 'XYZ' }),
    txn('b', { iso_currency_code: null, name: '  ', security_id: null }),
  ]);
  assert.equal(r.upserts[0].currency, 'XYZ');
  assert.equal(r.upserts[1].currency, 'USD');
  assert.equal(r.upserts[1].name, 'Unnamed activity');
  assert.equal(r.upserts[1].security_id, null);
});

test('accounts we do not track are skipped and counted, never an error', () => {
  const r = plan([txn('t1'), txn('t2', { account_id: 'other' })]);
  assert.equal(r.upserts.length, 1);
  assert.equal(r.skipped, 1);
});

test('zero-amount share moves are kept', () => {
  const r = plan([txn('t1', { type: 'transfer', subtype: 'transfer', amount: 0, quantity: 12 })]);
  assert.equal(r.upserts[0].amount, '0');
  assert.equal(r.upserts[0].quantity, '12');
});

test('the latest copy across pages wins', () => {
  const r = planInvestmentChanges(
    'c1',
    [
      { transactions: [txn('t1', { name: 'old' })], securities: [sec] },
      { transactions: [txn('t1', { name: 'new' })], securities: [] },
    ],
    accounts,
    'p',
    window,
  );
  assert.equal(r.upserts.length, 1);
  assert.equal(r.upserts[0].name, 'new');
});

test('saved rows Plaid no longer returns are removed, only inside a completely read window', () => {
  const saved = [
    { id: 'c1:t1', date: '2026-10-01' },
    { id: 'c1:gone', date: '2026-09-15' },
    { id: 'c1:old', date: '2026-01-01' },
  ];
  assert.deepEqual(plan([txn('t1')], saved).removeIds, ['c1:gone']);
  assert.deepEqual(plan([txn('t1')], saved, { ...window, complete: false }).removeIds, []);
  // a row that is returned again is not removed
  assert.deepEqual(plan([txn('t1'), txn('gone', { date: '2026-09-15' })], saved).removeIds, []);
});

test('asset classes match what the holdings sync always used', () => {
  assert.equal(assetClassOf({ is_cash_equivalent: true, type: 'equity' }), 'Cash');
  assert.equal(assetClassOf({ type: 'fixed income' }), 'Bonds');
  assert.equal(assetClassOf({ type: 'equity' }), 'Equities');
  assert.equal(assetClassOf({ type: 'etf' }), 'etf');
  assert.equal(assetClassOf({}), 'Other');
});

test('labels say what happened', () => {
  const l = (type: string, subtype: string | null, quantity: string, price: string | null = null) =>
    investmentLabel({ type, subtype, quantity, price, symbol: 'VOO' });
  assert.equal(l('buy', 'buy', '10', '500'), 'Buy · 10 VOO @ $500.00');
  assert.equal(l('sell', 'sell', '-2.5', '510.1'), 'Sell · 2.5 VOO @ $510.10');
  assert.equal(l('buy', 'buy', '0'), 'Buy');
  assert.equal(l('cash', 'dividend', '0'), 'Dividend');
  assert.equal(l('cash', 'deposit', '0'), 'Deposit');
  assert.equal(l('fee', 'account fee', '0'), 'Account fee');
  assert.equal(l('fee', 'fee', '0'), 'Fee');
  assert.equal(l('transfer', 'transfer', '12'), 'Shares in');
  assert.equal(l('transfer', 'transfer', '-12'), 'Shares out');
  assert.equal(l('transfer', 'transfer', '0'), 'Transfer');
  assert.equal(l('cancel', null, '0'), 'Cancelled');
  assert.equal(l('weird_kind', null, '0'), 'Weird kind');
});

test('demo activity is deterministic, recent, and uses the Plaid sign', async () => {
  const { demoActivity } = await import('../server/db/seed.ts');
  const today = new Date('2026-10-03T12:00:00Z');
  const rows = demoActivity(today);
  assert.deepEqual(rows, demoActivity(today));
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  assert.ok(rows.every((r) => r.date <= '2026-10-03' && r.date >= '2026-07-01'));
  assert.ok(rows.filter((r) => r.type === 'buy').every((r) => r.amount > 0 && r.quantity > 0));
  assert.ok(rows.filter((r) => r.subtype === 'dividend').every((r) => r.amount < 0));
  const moves = rows.filter((r) => r.type === 'transfer');
  assert.equal(
    moves.reduce((s, r) => s + r.quantity, 0),
    0,
    'shares out of one account land in the other',
  );
});
