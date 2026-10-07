import test from 'node:test';
import assert from 'node:assert/strict';
import { matchResentTransactions, type ProviderRow } from '../server/lib/transactions.ts';

const ACC = 'c:acc';
const cutoffs = new Map([[ACC, '2026-10-05']]);
const saved = (id: string, name = 'Coffee', date = '2026-09-08', amount = '4.33') => ({
  id,
  account_id: ACC,
  date,
  amount,
  name,
});
const incoming = (
  id: string,
  name = 'Coffee',
  date = '2026-09-08',
  amount = '4.33',
  extra: Partial<ProviderRow> = {},
) =>
  ({
    id,
    account_id: ACC,
    provider_id: id,
    date,
    amount,
    name,
    pending: false,
    ...extra,
  }) as ProviderRow;

test('a transaction sent again under a new id takes over the saved one', () => {
  const r = matchResentTransactions([incoming('c:new')], [saved('c:old')], cutoffs);
  assert.deepEqual(r, { carryOver: [{ fromId: 'c:old', toId: 'c:new' }], removeIds: ['c:old'] });
});

test('two identical coffees sent again pair one to one', () => {
  const r = matchResentTransactions(
    [incoming('c:n1'), incoming('c:n2')],
    [saved('c:o1'), saved('c:o2')],
    cutoffs,
  );
  assert.equal(r.carryOver.length, 2);
  assert.deepEqual(r.removeIds.sort(), ['c:o1', 'c:o2']);
  assert.equal(new Set(r.carryOver.map((c) => c.fromId)).size, 2);
});

test('only one of two saved coffees is sent again: the other saved row is left alone', () => {
  const r = matchResentTransactions([incoming('c:n1')], [saved('c:o1'), saved('c:o2')], cutoffs);
  assert.equal(r.carryOver.length, 1);
  assert.equal(r.removeIds.length, 1);
});

test('a second identical coffee has no partner and stays a new transaction', () => {
  const r = matchResentTransactions([incoming('c:n1'), incoming('c:n2')], [saved('c:o1')], cutoffs);
  assert.equal(r.carryOver.length, 1);
});

test('a row dated on or after the previous sync may be genuinely new: never paired', () => {
  for (const date of ['2026-10-05', '2026-10-06'])
    assert.equal(
      matchResentTransactions(
        [incoming('c:n', 'Coffee', date)],
        [saved('c:o', 'Coffee', date)],
        cutoffs,
      ).carryOver.length,
      0,
    );
  assert.equal(
    matchResentTransactions(
      [incoming('c:n', 'Coffee', '2026-10-04')],
      [saved('c:o', 'Coffee', '2026-10-04')],
      cutoffs,
    ).carryOver.length,
    1,
  );
});

test('date, amount, name and account must all agree', () => {
  for (const other of [
    incoming('c:n', 'Coffee', '2026-09-09'),
    incoming('c:n', 'Coffee', '2026-09-08', '4.34'),
    incoming('c:n', 'Tea'),
    incoming('c:n', 'Coffee', '2026-09-08', '4.33', { account_id: 'c:other' }),
  ])
    assert.equal(
      matchResentTransactions([other], [saved('c:o')], cutoffs).carryOver.length,
      0,
      other.name,
    );
});

test('amounts compare as numbers, not as text', () => {
  assert.equal(
    matchResentTransactions(
      [incoming('c:n', 'Coffee', '2026-09-08', '4.3300')],
      [saved('c:o')],
      cutoffs,
    ).carryOver.length,
    1,
  );
});

test('an update to a row we already have is not a re-send', () => {
  assert.equal(
    matchResentTransactions([incoming('c:o')], [saved('c:o')], cutoffs).carryOver.length,
    0,
  );
});

test('pending rows and rows already carried from a pending one are left alone', () => {
  assert.equal(
    matchResentTransactions(
      [incoming('c:n', 'Coffee', '2026-09-08', '4.33', { pending: true })],
      [saved('c:o')],
      cutoffs,
    ).carryOver.length,
    0,
  );
  assert.equal(
    matchResentTransactions([incoming('c:n')], [saved('c:o')], cutoffs, new Set(['c:n'])).carryOver
      .length,
    0,
  );
});

test('an account that was not just re-matched has no cutoff and nothing is paired', () => {
  assert.equal(
    matchResentTransactions([incoming('c:n')], [saved('c:o')], new Map()).carryOver.length,
    0,
  );
});
