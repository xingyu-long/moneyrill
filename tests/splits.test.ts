import test from 'node:test';
import assert from 'node:assert/strict';
import { splitProblem, splitsBalance } from '../server/lib/transactions.ts';
import { createGroupBody, splitsBody } from '../server/lib/schemas.ts';
import {
  draftProblem,
  evenShares,
  spreadDates,
  formatCents,
  parseCents,
  remainingCents,
  splitBody,
  totalCents,
} from '../src/lib/splits.ts';

test('a split must add up exactly, with the transaction sign, in 2 to 20 non-zero parts', () => {
  assert.equal(splitProblem('100.00', [{ amount: '60' }, { amount: '40.00' }]), null);
  assert.equal(splitProblem('64.10000000', [{ amount: 24.1 }, { amount: '40.00' }]), null);
  assert.equal(
    splitProblem('0.30', [{ amount: '0.1' }, { amount: '0.2' }]),
    null,
    'no float drift',
  );
  assert.match(
    splitProblem('100', [{ amount: '60' }, { amount: '30' }])!,
    /add up to 90\.00, not 100\.00/,
  );
  assert.match(splitProblem('100', [{ amount: '100' }])!, /at least two/);
  assert.match(splitProblem('100', Array(21).fill({ amount: '5' }))!, /at most 20/);
  assert.match(splitProblem('100', [{ amount: '100' }, { amount: '0' }])!, /needs an amount/);
  assert.match(splitProblem('0', [{ amount: '1' }, { amount: '-1' }])!, /no amount/);
});

test('money in splits with negative parts, and parts of the wrong sign are refused', () => {
  assert.equal(splitProblem('-50', [{ amount: '-20' }, { amount: '-30' }]), null);
  assert.match(splitProblem('-50', [{ amount: '20' }, { amount: '-70' }])!, /money in/);
  assert.match(splitProblem('50', [{ amount: '-20' }, { amount: '70' }])!, /money out/);
});

test('a saved split that no longer matches the bank amount is flagged', () => {
  assert.equal(splitsBalance('100.00000000', [{ amount: '60.00000000' }, { amount: '40' }]), true);
  assert.equal(splitsBalance('105.00000000', [{ amount: '60' }, { amount: '40' }]), false);
  assert.equal(splitsBalance('10', []), false);
});

test('the splits request body is validated', () => {
  const part = { amount: '5.00', category_id: 3, notes: '' };
  assert.ok(splitsBody.safeParse({ splits: [part, { ...part, category_id: null }] }).success);
  assert.equal(
    splitsBody.parse({ splits: [{ amount: 1, category_id: null }, part] }).splits[0].notes,
    '',
  );
  for (const bad of [
    {},
    { splits: [part] },
    { splits: Array(21).fill(part) },
    { splits: [part, { ...part, amount: '' }] },
    { splits: [part, { ...part, amount: 'abc' }] },
    { splits: [part, { ...part, category_id: '3' }] },
    { splits: [part, { ...part, notes: 'x'.repeat(2001) }] },
    { splits: [part, { ...part, name: 'extra' }] },
    { splits: [part, part], extra: 1 },
  ])
    assert.equal(splitsBody.safeParse(bad).success, false, JSON.stringify(bad));
  assert.ok(createGroupBody.safeParse({ name: 'x', type: 'expense' }).success);
});

test('cents helpers parse, format and balance without rounding errors', () => {
  assert.equal(parseCents('12.5'), 1250);
  assert.equal(parseCents(' 0.07 '), 7);
  assert.equal(parseCents('19.99'), 1999);
  for (const bad of ['', 'abc', '1.234', '-5', '1,000', '1e3', '.5'])
    assert.equal(parseCents(bad), null, bad);
  assert.equal(formatCents(1999), '19.99');
  assert.equal(totalCents('-64.10000000'), 6410);
  assert.equal(totalCents('12.345'), null, 'a fraction of a cent cannot be split');
  assert.equal(
    remainingCents(10000, [{ amount: '33.33', category_id: null, notes: '', date: null }]),
    6667,
  );
});

test('the editor says what is left, what is too much, and when it can be saved', () => {
  const p = (amount: string) => ({ amount, category_id: null, notes: '', date: null });
  assert.match(draftProblem(10000, [p('40')])!, /at least two/);
  assert.equal(draftProblem(10000, [p('40'), p('')]), '60.00 left to assign');
  assert.equal(draftProblem(10000, [p('70'), p('40')]), '10.00 too much');
  assert.equal(draftProblem(10000, [p('100'), p('')]), 'Every part needs an amount');
  assert.equal(draftProblem(10000, [p('33.33'), p('33.33'), p('33.34')]), null);
});

test('the request keeps the transaction sign and exact cents', () => {
  const p = (amount: string, category_id: number | null = null, date: string | null = null) => ({
    amount,
    category_id,
    notes: 'n',
    date,
  });
  assert.deepEqual(splitBody('64.10', [p('40', 2), p('24.1', null, '2026-11-02')]).splits, [
    { amount: '40.00', category_id: 2, notes: 'n', date: null },
    { amount: '24.10', category_id: null, notes: 'n', date: '2026-11-02' },
  ]);
  assert.deepEqual(
    splitBody('-50.00', [p('20'), p('30')]).splits.map((s) => s.amount),
    ['-20.00', '-30.00'],
  );
});

test('even shares add up exactly, with leftover cents going to the first parts', () => {
  assert.deepEqual(evenShares(10000, 4), [2500, 2500, 2500, 2500]);
  assert.deepEqual(evenShares(10000, 3), [3334, 3333, 3333]);
  assert.deepEqual(
    evenShares(1, 3),
    [1, 0, 0],
    'a part can end up empty; the editor refuses to save it',
  );
  assert.deepEqual(evenShares(6410, 2), [3205, 3205]);
  for (const [total, n] of [
    [9999, 7],
    [100, 20],
    [1, 2],
    [123457, 13],
  ])
    assert.equal(
      evenShares(total, n).reduce((a, b) => a + b, 0),
      total,
      `${total}/${n}`,
    );
});

test('dates can be spread weekly or monthly; the first part keeps the transaction date', () => {
  assert.deepEqual(spreadDates('2026-10-03', 3, 'same'), [null, null, null]);
  assert.deepEqual(spreadDates('2026-10-03', 3, 'weekly'), [null, '2026-10-10', '2026-10-17']);
  assert.deepEqual(spreadDates('2026-10-03', 3, 'monthly'), [null, '2026-11-03', '2026-12-03']);
  // a 31st lands on the last day of shorter months, and years roll over
  assert.deepEqual(spreadDates('2026-01-31', 4, 'monthly'), [
    null,
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
  ]);
  assert.deepEqual(spreadDates('2026-12-15', 2, 'monthly'), [null, '2027-01-15']);
  assert.deepEqual(spreadDates('2024-01-31', 2, 'monthly'), [null, '2024-02-29'], 'leap year');
});
