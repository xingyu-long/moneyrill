import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fillPeriods,
  nextPeriod,
  periodEnd,
  periodStart,
  savingsRate,
  shareOf,
} from '../server/lib/reports.ts';
import { reportQuery, transactionQuery } from '../server/lib/schemas.ts';
import { demoHistory, demoTransactions } from '../server/db/seed.ts';
import { averageOf } from '../src/lib/reports.ts';
import { mapProviderCategory } from '../server/lib/transactions.ts';

test('periods start and end on month, quarter and year boundaries', () => {
  assert.equal(periodStart('2026-05-17', 'month'), '2026-05-01');
  assert.equal(periodStart('2026-05-17', 'quarter'), '2026-04-01');
  assert.equal(periodStart('2026-12-31', 'quarter'), '2026-10-01');
  assert.equal(periodStart('2026-05-17', 'year'), '2026-01-01');
  assert.equal(periodEnd('2024-02-01', 'month'), '2024-02-29');
  assert.equal(periodEnd('2026-02-01', 'month'), '2026-02-28');
  assert.equal(periodEnd('2026-10-01', 'quarter'), '2026-12-31');
  assert.equal(periodEnd('2026-01-01', 'year'), '2026-12-31');
  assert.equal(nextPeriod('2026-12-01', 'month'), '2027-01-01');
  assert.equal(nextPeriod('2026-10-01', 'quarter'), '2027-01-01');
  assert.equal(nextPeriod('2026-01-01', 'year'), '2027-01-01');
});

const row = (start: string, income: string, expenses: string, net: string) => ({
  start,
  income,
  expenses,
  net,
});

test('missing periods become zeros and the range edges are marked partial', () => {
  const rows = [
    row('2026-01-01', '100.00', '40.00', '60.00'),
    row('2026-03-01', '0.00', '5.00', '-5.00'),
  ];
  const filled = fillPeriods(rows, '2026-01-01', '2026-03-31', 'month', true);
  assert.deepEqual(
    filled.map((p) => [p.start, p.end, p.income, p.partial]),
    [
      ['2026-01-01', '2026-01-31', '100.00', false],
      ['2026-02-01', '2026-02-28', '0.00', false],
      ['2026-03-01', '2026-03-31', '0.00', false],
    ],
  );
  // The range stops mid-month: that month is not finished. A start chosen mid-month cuts the first one too.
  const cut = fillPeriods(rows, '2026-01-15', '2026-03-10', 'month', true);
  assert.deepEqual(
    cut.map((p) => p.partial),
    [true, false, true],
  );
  // With no chosen start (all time), the first month is not called partial.
  assert.equal(fillPeriods(rows, '2026-01-15', '2026-03-31', 'month', false)[0].partial, false);
});

test('a very long range keeps the latest periods only', () => {
  assert.equal(fillPeriods([], '1900-01-01', '2026-10-01', 'month', false).length, 600);
  assert.equal(fillPeriods([], '1900-01-01', '2026-10-01', 'year', false).length, 127);
});

test('savings rate is net over income, and unavailable without income', () => {
  assert.equal(savingsRate('375529.04', '81554.91'), 21.7);
  assert.equal(savingsRate('100', '-50'), -50);
  assert.equal(savingsRate('0', '-10'), null);
  assert.equal(savingsRate('-5', '-10'), null);
});

test('shares are percentages of a positive total', () => {
  assert.equal(shareOf('50', '200'), 25);
  assert.equal(shareOf('1', '3'), 33.3);
  assert.equal(shareOf('5', '0'), 0);
});

test('report filters accept lists and reject bad input', () => {
  const ok = reportQuery.parse({ from: '2026-01-01', categories: '1,2,3', accounts: 'a:1,b' });
  assert.deepEqual(ok.categories, [1, 2, 3]);
  assert.deepEqual(ok.accounts, ['a:1', 'b']);
  assert.equal(ok.interval, 'month');
  assert.equal(ok.type, 'expense');
  for (const bad of [
    { from: '2026-02-01', to: '2026-01-01' },
    { from: '2026-13-01' },
    { categories: '1,x' },
    { categories: '0' },
    { interval: 'week' },
    { type: 'transfer' },
    { today: '2026-02-30' },
  ])
    assert.equal(reportQuery.safeParse(bad).success, false, JSON.stringify(bad));
  assert.deepEqual(transactionQuery.parse({ type: 'income', categories: '4' }).categories, [4]);
  assert.equal(transactionQuery.safeParse({ type: 'transfer' }).success, false);
});

test('report history is deterministic, older than the 90-day rows and maps to its own categories', () => {
  const today = new Date('2026-10-03T12:00:00Z');
  const a = demoHistory(today);
  assert.deepEqual(a, demoHistory(today));
  assert.equal(new Set(a.rows.map((r) => r.id)).size, a.rows.length);
  const recent = demoTransactions(today);
  const oldest90 = recent.map((r) => r.date).sort()[0];
  const dates = a.rows.map((r) => r.date).sort();
  assert.ok(dates[dates.length - 1] < oldest90, 'no overlap with the 90-day demo rows');
  assert.ok(dates[0] <= '2024-09-30' && dates[0] >= '2024-08-01', 'about two years of history');
  assert.ok(a.rows.length > 600 && a.rows.length < 1000);
  for (const r of a.rows)
    assert.equal(mapProviderCategory(r.pc, r.pd, r.name), r.key, r.id + ' ' + r.name);
  const keys = new Set(a.rows.map((r) => r.key));
  for (const k of ['paychecks', 'credit_card_payment', 'transfer', 'uncategorized', 'other_income'])
    assert.ok(keys.has(k), k);
  assert.ok(
    a.rows.some((r) => r.amount < 0 && r.key === 'shopping'),
    'a refund',
  );
  // The split adds up to its parent and one part falls in the next month.
  const parent = a.rows.find((r) => r.id === a.splits[0].txn)!;
  assert.equal(
    a.splits.reduce((n, p) => n + p.amount, 0),
    parent.amount,
  );
  assert.ok(a.splits.some((p) => p.date && p.date.slice(0, 7) !== parent.date.slice(0, 7)));
});

test('a daily series has one period per day, zeros included, and crosses month ends', () => {
  assert.equal(periodStart('2026-05-17', 'day'), '2026-05-17');
  assert.equal(periodEnd('2026-05-17', 'day'), '2026-05-17');
  assert.equal(nextPeriod('2026-02-28', 'day'), '2026-03-01');
  assert.equal(nextPeriod('2024-02-28', 'day'), '2024-02-29');
  assert.equal(nextPeriod('2026-12-31', 'day'), '2027-01-01');
  const rows = [{ start: '2026-10-02', income: '0.00', expenses: '9.50', net: '-9.50' }];
  const days = fillPeriods(rows, '2026-10-01', '2026-10-03', 'day', true);
  assert.deepEqual(
    days.map((d) => [d.start, d.expenses, d.partial]),
    [
      ['2026-10-01', '0.00', false],
      ['2026-10-02', '9.50', false],
      ['2026-10-03', '0.00', false],
    ],
  );
  assert.equal(reportQuery.safeParse({ interval: 'day' }).success, true);
  assert.equal(reportQuery.safeParse({ interval: 'week' }).success, false);
});

test('the history average covers finished periods, zeros included, and falls back to the partial one', () => {
  const row = (value: string, partial = false) => ({ value, partial });
  assert.equal(averageOf([]), null);
  assert.equal(averageOf([row('0.00'), row('3000.00'), row('1000.00')]), 1333.33);
  assert.equal(
    averageOf([row('100.00'), row('300.00'), row('50.00', true)]),
    200,
    'this month is not counted yet',
  );
  assert.equal(averageOf([row('50.00', true)]), 50);
  assert.equal(averageOf([row('0.10'), row('0.20')]), 0.15);
});
