import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LAYOUT,
  HOME_WIDGETS,
  dropIndex,
  moveWidget,
  moveWidgetTo,
  nudgeWidget,
  parseLayout,
  toggleWidget,
  visibleWidgets,
} from '../src/lib/homeLayout.ts';
import { buildComparison, comparisonPlan, weekStart } from '../src/lib/spendingCompare.ts';

const ids = HOME_WIDGETS.map((w) => w.id);

test('Home shows the mockup modules in the default order until the owner changes it', () => {
  assert.deepEqual(parseLayout(null), DEFAULT_LAYOUT);
  // Spending and Accounts are off until chosen in Customize Home; the rest follow the mockup
  assert.deepEqual(visibleWidgets(DEFAULT_LAYOUT), [
    'month',
    'assets',
    'investments',
    'categories',
    'transactions',
  ]);
  assert.deepEqual(DEFAULT_LAYOUT.hidden, ['spending', 'accounts']);
  assert.equal(DEFAULT_LAYOUT.order.length, ids.length);
  // Net worth is the hero above the cards, always there: it is not a card to hide or move
  assert.ok(!(ids as string[]).includes('net-worth'));
  for (const bad of ['not json', '{}', '[]', '"x"', '{"order":"a"}'])
    assert.deepEqual(parseLayout(bad), DEFAULT_LAYOUT, bad);
});

test('a saved layout is repaired: unknown and repeated modules go, new modules are appended and shown', () => {
  const l = parseLayout(
    JSON.stringify({
      order: ['transactions', 'nope', 'transactions', 'spending'],
      hidden: ['spending', 'nope', 7],
      compare: 'week',
      v: 2,
    }),
  );
  assert.deepEqual(l.order.slice(0, 2), ['transactions', 'spending']);
  assert.equal(new Set(l.order).size, ids.length);
  assert.deepEqual(l.hidden, ['spending']);
  assert.equal(l.compare, 'week');
  assert.ok(visibleWidgets(l).includes('month'));
  // a layout saved when Net worth was a card has it dropped
  assert.ok(
    !parseLayout(
      JSON.stringify({ order: ['net-worth', 'month'], hidden: ['net-worth'], v: 2 }),
    ).order.includes('net-worth' as never),
  );
  assert.equal(parseLayout('{"order":[],"compare":"bad","v":2}').compare, 'month');
  // a layout saved before the mockup design has no version, so it is not used: the new default applies
  assert.deepEqual(
    parseLayout(JSON.stringify({ order: ['accounts'], hidden: ['month'] })),
    DEFAULT_LAYOUT,
  );
});

test('modules can be hidden, shown again, and moved without losing any', () => {
  const hidden = toggleWidget(DEFAULT_LAYOUT, 'month');
  assert.ok(!visibleWidgets(hidden).includes('month'));
  assert.equal(hidden.order.length, ids.length, 'hiding keeps its place');
  assert.deepEqual(toggleWidget(hidden, 'month'), DEFAULT_LAYOUT);
  assert.ok(visibleWidgets(toggleWidget(DEFAULT_LAYOUT, 'accounts')).includes('accounts'));
  const moved = moveWidget(DEFAULT_LAYOUT, 'transactions', 'month');
  assert.equal(moved.order[0], 'transactions');
  assert.deepEqual([...moved.order].sort(), [...ids].sort());
  assert.equal(moveWidget(DEFAULT_LAYOUT, 'month', 'month'), DEFAULT_LAYOUT);
  assert.equal(nudgeWidget(DEFAULT_LAYOUT, 'month', -1), DEFAULT_LAYOUT, 'already first');
  assert.equal(nudgeWidget(DEFAULT_LAYOUT, 'month', 1).order[1], 'month');
  assert.equal(DEFAULT_LAYOUT.order[0], 'month', 'This month leads the cards by default');
});

const days = (month: string, amounts: Record<number, string>) =>
  Object.entries(amounts).map(([d, expenses]) => ({
    start: `${month}-${String(d).padStart(2, '0')}`,
    expenses,
  }));

test('the plan asks for just the days the comparison needs', () => {
  assert.deepEqual(comparisonPlan('month', '2026-10-05'), {
    from: '2026-09-01',
    to: '2026-10-05',
    interval: 'day',
  });
  assert.equal(comparisonPlan('month-year', '2026-10-05').from, '2025-10-01');
  assert.equal(comparisonPlan('average', '2026-10-05').from, '2025-10-01');
  assert.equal(comparisonPlan('month', '2026-01-15').from, '2025-12-01');
  assert.deepEqual(comparisonPlan('year', '2026-10-05'), {
    from: '2025-01-01',
    to: '2026-10-05',
    interval: 'month',
  });
  assert.equal(weekStart('2026-10-05'), '2026-10-04', 'weeks start on Sunday');
  assert.equal(comparisonPlan('week', '2026-10-05').from, '2026-09-27');
});

test('this month against last month are running totals that stop at today', () => {
  const c = buildComparison('month', '2026-10-03', [
    ...days('2026-09', { 1: '10.10', 2: '20.20', 30: '5.00' }),
    ...days('2026-10', { 1: '100.00', 3: '50.50' }),
  ]);
  assert.equal(c.rows.length, 31, 'as long as the longer month');
  assert.deepEqual(c.rows[0], { label: 'Day 1', current: 100, previous: 10.1 });
  assert.deepEqual(c.rows[2], { label: 'Day 3', current: 150.5, previous: 30.3 });
  assert.equal(c.rows[3].current, null, 'no line after today');
  assert.equal(c.rows[29].previous, 35.3);
  assert.equal(c.rows[30].previous, null, 'September has no 31st');
  assert.equal(c.current.toFixed(2), '150.50');
  assert.equal(c.previousSoFar.toFixed(2), '30.30');
  assert.equal(c.previousLabel, 'September');
});

test('money is summed without floating-point drift', () => {
  const c = buildComparison('month', '2026-10-03', days('2026-10', { 1: '0.10', 2: '0.20' }));
  assert.equal(c.rows[1].current, 0.3);
});

test('this week against last week, Sunday first', () => {
  const c = buildComparison('week', '2026-10-06', [
    { start: '2026-09-28', expenses: '7.00' },
    { start: '2026-10-04', expenses: '1.00' },
    { start: '2026-10-06', expenses: '2.00' },
  ]);
  assert.deepEqual(
    c.rows.map((r) => r.label),
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  );
  assert.equal(c.rows[2].current, 3);
  assert.equal(c.rows[3].current, null);
  assert.equal(c.rows[1].previous, 7);
  assert.equal(c.rows[6].previous, 7);
  assert.equal(c.previousSoFar.toFixed(2), '7.00');
});

test('this year against last year is month by month', () => {
  const c = buildComparison('year', '2026-03-10', [
    { start: '2025-01-01', expenses: '100.00' },
    { start: '2025-03-01', expenses: '50.00' },
    { start: '2026-01-01', expenses: '10.00' },
    { start: '2026-03-01', expenses: '5.00' },
  ]);
  assert.equal(c.rows.length, 12);
  assert.equal(c.rows[2].current, 15);
  assert.equal(c.rows[3].current, null);
  assert.equal(c.rows[11].previous, 150);
  assert.equal(c.previousSoFar.toFixed(2), '150.00');
  assert.equal(c.previousLabel, '2025');
});

test('the same month last year is its own line', () => {
  const c = buildComparison('month-year', '2028-02-02', [
    { start: '2027-02-01', expenses: '4.00' },
    { start: '2028-02-01', expenses: '1.00' },
  ]);
  assert.equal(c.previousLabel, 'February 2027');
  assert.equal(c.rows[27].previous, 4);
  assert.equal(c.rows[28].previous, null, '2027 was not a leap year');
  assert.equal(c.rows[1].current, 1);
});

test('the average month skips months before spending began and averages running totals', () => {
  const c = buildComparison('average', '2026-10-02', [
    ...days('2026-08', { 1: '30.00' }),
    ...days('2026-09', { 1: '10.00', 30: '60.00' }),
    ...days('2026-10', { 1: '5.00' }),
  ]);
  // two months count (August, September), not the ten empty ones before
  assert.equal(c.rows[0].previous, 20);
  assert.equal(c.rows[1].previous, 20);
  assert.equal(c.rows[29].previous, 50, 'Aug 30 total 30, Sep 30 total 70');
  assert.equal(c.rows[30].previous, 30, 'only August has a 31st');
  assert.equal(c.previousLabel, 'Average month');
  assert.equal(c.current.toFixed(2), '5.00');
});

test('with no spending at all nothing breaks', () => {
  for (const mode of ['week', 'month', 'month-year', 'average', 'year'] as const) {
    const c = buildComparison(mode, '2026-10-05', []);
    assert.equal(c.any, false, mode);
    assert.equal(c.current.toFixed(2), '0.00', mode);
    assert.ok(c.rows.length >= 7, mode);
  }
});

test('a dragged module lands where the pointer is, however many rows that skips', () => {
  assert.equal(dropIndex([20, 70, 120], 10), 0);
  assert.equal(dropIndex([20, 70, 120], 100), 2);
  assert.equal(dropIndex([20, 70, 120], 500), 3);
  const l = moveWidgetTo(DEFAULT_LAYOUT, 'month', 4);
  assert.equal(l.order[4], 'month');
  assert.deepEqual([...l.order].sort(), [...ids].sort());
  assert.equal(moveWidgetTo(DEFAULT_LAYOUT, 'month', 0), DEFAULT_LAYOUT);
  assert.equal(moveWidgetTo(DEFAULT_LAYOUT, 'transactions', 99).order.at(-1), 'transactions');
  assert.equal(moveWidgetTo(DEFAULT_LAYOUT, 'month', -3), DEFAULT_LAYOUT);
});
