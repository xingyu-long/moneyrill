import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  dayLabel,
  monthGrid,
  monthTitle,
  parseIso,
  shiftMonth,
  toIso,
} from '../src/lib/calendar.ts';

test('dates are parsed strictly and impossible dates are refused', () => {
  assert.deepEqual(parseIso('2026-10-03'), { y: 2026, m: 10, d: 3 });
  for (const bad of ['2026-02-30', '2026-13-01', '10/03/2026', '2026-1-3', '', '2026-00-10'])
    assert.equal(parseIso(bad), null, bad);
  assert.deepEqual(parseIso('2024-02-29'), { y: 2024, m: 2, d: 29 }, 'leap day');
  assert.equal(parseIso('2026-02-29'), null);
});

test('day arithmetic crosses months and years without time zones', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2024-02-28', 2), '2024-03-01');
  assert.equal(toIso(2026, 3, 7), '2026-03-07');
});

test('months step across year boundaries', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { y: 2027, m: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { y: 2025, m: 12 });
  assert.deepEqual(shiftMonth(2026, 10, -22), { y: 2024, m: 12 });
  assert.equal(monthTitle(2026, 10), 'October 2026');
  assert.equal(dayLabel('2026-10-19'), 'October 19, 2026');
});

test('the month grid starts on Sunday and includes the neighbouring days', () => {
  const grid = monthGrid(2026, 10); // October 2026 starts on a Thursday
  assert.equal(grid.length, 5);
  assert.ok(grid.every((w) => w.length === 7));
  assert.deepEqual(
    grid[0].map((c) => c.day),
    [27, 28, 29, 30, 1, 2, 3],
  );
  assert.deepEqual(
    grid[0].map((c) => c.inMonth),
    [false, false, false, false, true, true, true],
  );
  assert.equal(grid[4][6].iso, '2026-10-31');
  assert.equal(
    monthGrid(2026, 2).length,
    4,
    'a 28-day February starting on Sunday fits four weeks',
  );
  assert.equal(monthGrid(2026, 3).length, 5);
  assert.equal(monthGrid(2027, 5).length, 6, 'a month can need six weeks');
  assert.equal(monthGrid(2026, 2)[0][0].iso, '2026-02-01', 'Feb 2026 starts on a Sunday');
});
