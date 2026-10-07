import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_TIME,
  lastRange,
  parseSpec,
  rangeLabel,
  resolveSpec,
  specLabel,
} from '../src/lib/reportDates.ts';
import {
  chartRows,
  historyRows,
  periodOf,
  legend,
  periodLabel,
  periodTitle,
  toCsv,
} from '../src/lib/reports.ts';

const today = '2026-10-03';

test('presets resolve to calendar days', () => {
  const r = (id: any) => resolveSpec({ mode: 'preset', id }, today);
  assert.deepEqual(r('last7'), { from: '2026-09-27', to: today });
  assert.deepEqual(r('last30'), { from: '2026-09-04', to: today });
  assert.deepEqual(r('thisMonth'), { from: '2026-10-01', to: today });
  assert.deepEqual(r('lastMonth'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(r('thisYear'), { from: '2026-01-01', to: today });
  assert.deepEqual(r('lastYear'), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(resolveSpec(ALL_TIME, today), {});
});

test('last month and last year work across a year boundary and in leap years', () => {
  assert.deepEqual(resolveSpec({ mode: 'preset', id: 'lastMonth' }, '2026-01-15'), {
    from: '2025-12-01',
    to: '2025-12-31',
  });
  assert.deepEqual(resolveSpec({ mode: 'preset', id: 'lastMonth' }, '2024-03-10'), {
    from: '2024-02-01',
    to: '2024-02-29',
  });
});

test('"Last N units" includes today and counts whole units back', () => {
  assert.deepEqual(lastRange(1, 'day', today), { from: today, to: today });
  assert.deepEqual(lastRange(2, 'week', today), { from: '2026-09-20', to: today });
  assert.deepEqual(lastRange(3, 'month', today), { from: '2026-07-04', to: today });
  assert.deepEqual(lastRange(1, 'quarter', today), { from: '2026-07-04', to: today });
  assert.deepEqual(lastRange(1, 'year', today), { from: '2025-10-04', to: today });
  // a month with no such day: Mar 31 minus one month is the end of February
  assert.deepEqual(lastRange(1, 'month', '2026-03-31'), { from: '2026-03-01', to: '2026-03-31' });
  assert.deepEqual(lastRange(1, 'year', '2024-02-29'), { from: '2023-03-01', to: '2024-02-29' });
});

test('labels', () => {
  assert.equal(specLabel(ALL_TIME), 'All time');
  assert.equal(specLabel({ mode: 'preset', id: 'lastMonth' }), 'Last month');
  assert.equal(specLabel({ mode: 'last', n: 3, unit: 'month' }), 'Last 3 months');
  assert.equal(specLabel({ mode: 'last', n: 1, unit: 'week' }), 'Last 1 week');
  assert.equal(rangeLabel('2026-09-01', '2026-09-30'), 'Sep 1, 2026 – Sep 30, 2026');
});

test('a stored spec is only trusted when it is valid', () => {
  assert.deepEqual(parseSpec({ mode: 'last', n: 3, unit: 'month' }), {
    mode: 'last',
    n: 3,
    unit: 'month',
  });
  for (const bad of [
    null,
    'x',
    { mode: 'preset', id: 'nope' },
    { mode: 'last', n: 0, unit: 'day' },
    { mode: 'last', n: 1.5, unit: 'day' },
    { mode: 'last', n: 101, unit: 'year' },
    { mode: 'last', n: 3, unit: 'decade' },
    { mode: 'range', from: '2026-02-01', to: '2026-01-01' },
    { mode: 'range', from: '2026-02-30', to: '2026-03-01' },
  ])
    assert.deepEqual(parseSpec(bad), ALL_TIME, JSON.stringify(bad));
});

const slice = (id: number, amount: string, share: number) => ({
  category: { id, name: 'C' + id, emoji: '', group: 'G' },
  amount,
  share,
});

test('the legend keeps the top 11, folds the rest and drops categories that are not positive', () => {
  const many = Array.from({ length: 14 }, (_, i) => slice(i + 1, String(100 - i), 5));
  const l = legend([...many, slice(99, '-5.00', 0), slice(98, '0.00', 0)]);
  assert.equal(l.items.length, 12);
  assert.equal(l.items[11].label, 'Everything else');
  assert.equal(l.items[11].amount, String(89 + 88 + 87) + '.00');
  assert.equal(l.items[11].share, 15);
  assert.equal(l.all.length, 14);
  // exactly 12 categories fit without folding
  assert.equal(legend(many.slice(0, 12)).items.length, 12);
  assert.equal(legend(many.slice(0, 12)).items.at(-1)!.label, 'C12');
});

test('chart rows put expenses below zero and dash the unfinished periods', () => {
  const p = (start: string, partial = false) => ({
    start,
    end: start,
    income: '100.00',
    expenses: '40.00',
    net: '60.00',
    partial,
  });
  const rows = chartRows([p('2025-12-01'), p('2026-01-01'), p('2026-02-01', true)], 'month');
  assert.deepEqual(
    rows.map((r) => [r.label, r.expenses, r.solid, r.dashed]),
    [
      ['Dec ’25', -40, 60, null],
      ['Jan ’26', -40, 60, 60],
      ['Feb ’26', -40, null, 60],
    ],
  );
  // The month, quarter or year holding a day, first to last day.
  assert.deepEqual(periodOf('2026-10-05', 'month'), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(periodOf('2028-02-29', 'month'), { start: '2028-02-01', end: '2028-02-29' });
  assert.deepEqual(periodOf('2026-08-15', 'quarter'), { start: '2026-07-01', end: '2026-09-30' });
  assert.deepEqual(periodOf('2026-12-31', 'quarter'), { start: '2026-10-01', end: '2026-12-31' });
  assert.deepEqual(periodOf('2026-10-05', 'year'), { start: '2026-01-01', end: '2026-12-31' });
  assert.equal(periodLabel({ start: '2026-07-01' }, 'quarter', true), 'Q3 2026');
  assert.equal(periodLabel({ start: '2026-07-01' }, 'month', true), 'Jul 2026');
  assert.equal(periodLabel({ start: '2026-07-01' }, 'month', false), 'Jul ’26');
  assert.equal(periodLabel({ start: '2026-07-01' }, 'year', false), '2026');
});

test('one category per period: its side of the cash flow, and a title for the chosen period', () => {
  const p = (start: string, income: string, expenses: string) => ({
    start,
    end: start,
    income,
    expenses,
    net: '0',
    partial: false,
  });
  const series = [p('2026-08-01', '0.00', '1850.00'), p('2026-09-01', '5.00', '-20.00')];
  assert.deepEqual(
    historyRows(series, 'expense', 'month').map((r) => [r.label, r.amount, r.value]),
    [
      ['Aug ’26', 1850, '1850.00'],
      ['Sep ’26', -20, '-20.00'],
    ],
  );
  assert.deepEqual(
    historyRows(series, 'income', 'month').map((r) => r.amount),
    [0, 5],
  );
  assert.equal(periodTitle({ start: '2026-09-01' }, 'month'), 'September 2026');
  assert.equal(periodTitle({ start: '2026-07-01' }, 'quarter'), 'Q3 2026');
  assert.equal(periodTitle({ start: '2026-01-01' }, 'year'), '2026');
});

test('csv quotes cells and defuses formulas', () => {
  assert.equal(
    toCsv(
      ['a', 'b'],
      [
        ['x,y', 'say "hi"'],
        ['=1+1', '-5'],
      ],
    ),
    'a,b\r\n"x,y","say ""hi"""\r\n\'=1+1,-5\r\n',
  );
});
