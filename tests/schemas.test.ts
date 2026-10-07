import test from 'node:test';
import assert from 'node:assert/strict';
import {
  archiveAccount,
  archiveBalance,
  archiveBenchmark,
  archiveHolding,
  archiveShape,
  createAccountBody,
  ensure,
  linkBody,
  manualBalance,
  manualHoldingsBody,
} from '../server/lib/schemas.ts';

const ok = (schema: any, value: unknown) =>
  assert.ok(schema.safeParse(value).success, JSON.stringify(value));
const bad = (schema: any, value: unknown) =>
  assert.ok(!schema.safeParse(value).success, JSON.stringify(value));

test('manual accounts need a name, a known type and a finite balance', () => {
  ok(createAccountBody, { name: 'Savings', kind: 'cash', balance: '12.50' });
  ok(createAccountBody, { name: ' Card ', kind: 'credit', balance: 0, institution: 'Bank' });
  ok(createAccountBody, { name: 'Loan', kind: 'loan', balance: -5, institution: null });
  bad(createAccountBody, { name: '   ', kind: 'cash', balance: 1 });
  bad(createAccountBody, { name: 'x', kind: 'crypto', balance: 1 });
  bad(createAccountBody, { name: 'x', kind: 'cash', balance: '' });
  bad(createAccountBody, { name: 'x', kind: 'cash', balance: 'abc' });
  bad(createAccountBody, { name: 'x', kind: 'cash', balance: null });
  bad(createAccountBody, { name: 'x', kind: 'cash', balance: Infinity });
  bad(createAccountBody, { name: 'x', kind: 'cash', balance: true });
  bad(createAccountBody, { kind: 'cash', balance: 1 });
});

test('balance updates reject blanks and non-numbers', () => {
  ok(manualBalance, '1500.25');
  ok(manualBalance, 0);
  bad(manualBalance, '');
  bad(manualBalance, 'ten');
  bad(manualBalance, undefined);
  bad(manualBalance, null);
});

test('archive shape and records', () => {
  ok(archiveShape, { version: 1, tables: { accounts: [] }, environment: 'sandbox' });
  bad(archiveShape, { version: 2, tables: { accounts: [] } });
  bad(archiveShape, { version: 1, tables: {} });
  bad(archiveShape, null);
  ok(archiveAccount, { id: 'a', name: 'N', kind: 'cash', extra: 1 });
  bad(archiveAccount, { id: 'a', name: '', kind: 'cash' });
  bad(archiveAccount, { id: 1, name: 'N', kind: 'cash' });
  ok(archiveBalance, {
    account_id: 'a',
    date: '2026-10-03T00:00:00.000Z',
    current_balance: '1.50000000',
  });
  ok(archiveBalance, { account_id: 'a', date: '2026-10-03', current_balance: null });
  bad(archiveBalance, { account_id: 'a', date: '2026-10-03' });
  bad(archiveBalance, { account_id: 'a', date: '', current_balance: 1 });
  ok(archiveHolding, {
    account_id: 'a',
    security_id: 's',
    date: '2026-10-03',
    quantity: '1',
    price: null,
    value: 2,
  });
  bad(archiveHolding, { account_id: 'a', security_id: 's', date: '2026-10-03', quantity: 'many' });
  ok(archiveBenchmark, {
    symbol: 'X',
    date: '2026-10-03',
    level: '100.5',
    provenance: 'simulated',
  });
  bad(archiveBenchmark, {
    symbol: 'X',
    date: '2026-10-03',
    level: 'high',
    provenance: 'simulated',
  });
});

test('link requests accept no body or a connection id only', () => {
  ok(linkBody, undefined);
  ok(linkBody, {});
  ok(linkBody, { connectionId: 'item-1' });
  bad(linkBody, { connectionId: 5 });
});

test('ensure throws the supplied message', () => {
  assert.throws(
    () => ensure(manualBalance, 'x', 'Balance must be a number'),
    /Balance must be a number/,
  );
  assert.equal(ensure(manualBalance, '5', 'unused'), '5');
});

import {
  createCategoryBody,
  createGroupBody,
  createTransactionBody,
  splitsBody,
  updateGroupBody,
  transactionQuery,
  updateCategoryBody,
  updateTransactionBody,
} from '../server/lib/schemas.ts';

test('transaction edits accept a real date, a category id and notes', () => {
  assert.ok(updateTransactionBody.safeParse({ date: '2026-10-02' }).success);
  assert.ok(updateTransactionBody.safeParse({ date: null }).success); // reset to the bank date
  assert.ok(updateTransactionBody.safeParse({ category_id: 4 }).success);
  assert.ok(updateTransactionBody.safeParse({ category_id: null }).success); // back to automatic
  assert.ok(updateTransactionBody.safeParse({ notes: 'split with Jim' }).success);
  assert.ok(updateTransactionBody.safeParse({ notes: '' }).success);
});

test('transaction edits reject impossible dates, far-future dates, bad ids and long notes', () => {
  for (const bad of [
    {},
    { date: '2026-02-30' },
    { date: '10/02/2026' },
    { date: '2999-01-01' },
    { category_id: '4' },
    { category_id: 0 },
    { category_id: 1.5 },
    { notes: 'x'.repeat(2001) },
    { amount: 0 },
    { amount: '-5' },
    { amount: '1.234' },
    { name: '   ' },
    { direction: 'sideways' },
    { account_id: '' },
    { pending: false }, // never editable
    { source: 'manual' },
  ])
    assert.equal(updateTransactionBody.safeParse(bad).success, false, JSON.stringify(bad));
});

test('transaction list filters are validated and limited', () => {
  assert.equal(transactionQuery.parse({}).limit, 100);
  assert.equal(transactionQuery.parse({ limit: '25', category: '3' }).category, 3);
  assert.equal(transactionQuery.safeParse({ limit: '501' }).success, false);
  assert.equal(transactionQuery.safeParse({ from: 'yesterday' }).success, false);
});

test('a split part may carry its own date: a real date, not far ahead, or null for the same day', () => {
  const part = { amount: '5.00', category_id: 3, notes: '' };
  const withDate = (date: unknown) => splitsBody.safeParse({ splits: [part, { ...part, date }] });
  assert.ok(withDate('2026-11-02').success);
  assert.ok(withDate(null).success);
  assert.ok(splitsBody.safeParse({ splits: [part, part] }).success, 'the date is optional');
  for (const bad of ['2026-02-30', '11/02/2026', '', '2999-01-01', 5])
    assert.equal(withDate(bad).success, false, String(bad));
});

test('categories need a name and a group; groups need a name and one of three types', () => {
  assert.equal(createCategoryBody.parse({ name: '  Pets ', group_id: 3 }).name, 'Pets');
  assert.ok(createCategoryBody.safeParse({ name: 'Pets', group_id: 3, emoji: '🧑‍💻' }).success);
  for (const bad of [
    { name: 'Pets' }, // a group is required
    { name: '   ', group_id: 3 },
    { name: 'x'.repeat(61), group_id: 3 },
    { name: 'Pets', group_id: '3' },
    { name: 'Pets', group_id: 3, group_name: 'Other' },
    { name: 'Pets', group_id: 3, emoji: 'x'.repeat(17) },
  ])
    assert.equal(createCategoryBody.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(updateCategoryBody.safeParse({}).success, false);
  assert.ok(updateCategoryBody.safeParse({ emoji: '🐶' }).success);
  assert.ok(updateCategoryBody.safeParse({ group_id: 2 }).success);
  assert.ok(createGroupBody.safeParse({ name: 'Pets', type: 'expense' }).success);
  for (const bad of [
    { name: 'Pets', type: 'other' },
    { name: '', type: 'income' },
    { name: 'Pets' },
  ])
    assert.equal(createGroupBody.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(updateGroupBody.parse({ name: ' Fun ' }).name, 'Fun');
});

test('what you add by hand needs an account, a date, a name, a positive amount and a direction', () => {
  const ok = {
    account_id: 'a1',
    date: '2026-09-15',
    amount: '12500.00',
    direction: 'in',
    name: 'RSU vest',
  };
  assert.ok(createTransactionBody.safeParse(ok).success);
  assert.ok(
    createTransactionBody.safeParse({
      ...ok,
      amount: 40.5,
      direction: 'out',
      category_id: 3,
      notes: 'x',
    }).success,
  );
  assert.ok(createTransactionBody.safeParse({ ...ok, category_id: null }).success);
  assert.equal(createTransactionBody.parse({ ...ok, name: '  RSU vest  ' }).name, 'RSU vest');
  for (const amount of ['1', '0.01', '999999999999.99', 5])
    assert.ok(createTransactionBody.safeParse({ ...ok, amount }).success, String(amount));
  for (const bad of [
    {},
    { ...ok, account_id: '' },
    { ...ok, date: '2026-02-30' },
    { ...ok, date: '2999-01-01' },
    { ...ok, name: '   ' },
    { ...ok, name: 'x'.repeat(201) },
    { ...ok, amount: '0' },
    { ...ok, amount: 0 },
    { ...ok, amount: '-1' },
    { ...ok, amount: '1.234' },
    { ...ok, amount: '1,000' },
    { ...ok, amount: '1e3' },
    { ...ok, amount: '1000000000000' },
    { ...ok, amount: '' },
    { ...ok, direction: 'both' },
    { ...ok, direction: undefined },
    { ...ok, category_id: '3' },
    { ...ok, notes: 'x'.repeat(2001) },
    { ...ok, pending: true },
    { ...ok, source: 'plaid' },
  ])
    assert.equal(createTransactionBody.safeParse(bad).success, false, JSON.stringify(bad));
});

test('your own transactions can also change name, amount, direction and account', () => {
  for (const good of [
    { name: 'New name' },
    { amount: '13000' },
    { amount: 12.5, direction: 'out' },
    { direction: 'in' },
    { account_id: 'a2' },
    { name: 'x', amount: '5', direction: 'in', account_id: 'a2', date: '2026-09-16', notes: 'n' },
  ])
    assert.ok(updateTransactionBody.safeParse(good).success, JSON.stringify(good));
});

test('typed-in holdings: a name, a type, shares above zero and a price', () => {
  const line = {
    symbol: ' voo ',
    name: ' Vanguard ',
    asset_class: 'Equities',
    quantity: '2.5',
    price: 100,
  };
  const ok = manualHoldingsBody.safeParse({ holdings: [line] });
  assert.ok(ok.success);
  assert.deepEqual(ok.data.holdings[0].symbol, 'VOO');
  assert.deepEqual(ok.data.holdings[0].name, 'Vanguard');
  assert.ok(manualHoldingsBody.safeParse({ holdings: [] }).success); // clearing the list is allowed
  assert.ok(manualHoldingsBody.safeParse({ holdings: [{ ...line, price: '0' }] }).success);
  for (const bad of [
    { ...line, quantity: '0' },
    { ...line, quantity: '-1' },
    { ...line, quantity: 'abc' },
    { ...line, price: '-1' },
    { ...line, price: '' },
    { ...line, name: '  ' },
    { ...line, symbol: 'TOOLONGSYMBOLS' },
    { ...line, asset_class: 'Crypto' },
    { ...line, extra: 1 },
    { ...line, quantity: '1.123456789' },
  ])
    assert.equal(
      manualHoldingsBody.safeParse({ holdings: [bad] }).success,
      false,
      JSON.stringify(bad),
    );
  assert.equal(manualHoldingsBody.safeParse({ holdings: Array(101).fill(line) }).success, false);
  assert.equal(manualHoldingsBody.safeParse({}).success, false);
});
