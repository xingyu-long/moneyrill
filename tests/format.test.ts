import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cash,
  dateLabel,
  dateLabelYear,
  share,
  percent,
  pct,
  delta,
  number,
} from '../src/lib/format.ts';
import { openingDate, startDate } from '../src/lib/periods.ts';

test('cash formats dollars and treats unknown as a dash', () => {
  assert.equal(cash(1234.5), '$1,234.50');
  assert.equal(cash(-5), '-$5.00');
  assert.equal(cash(null), '—');
  assert.equal(cash(NaN), '—');
  assert.equal(cash(1_250_000, true), '$1.3M');
});

test('percent is signed and handles missing values', () => {
  assert.equal(percent(9.056), '+9.06%');
  assert.equal(percent(-0.4), '-0.40%');
  assert.equal(percent(null), '—');
});

test('pct is unavailable for a zero, negative or unknown baseline', () => {
  assert.equal(pct(110, 100), 10.000000000000009);
  assert.equal(pct(5, 0), null);
  assert.equal(pct(5, -3), null);
  assert.equal(pct(5, null), null);
  assert.equal(delta(5, null), null);
  assert.equal(delta(5, 2), 3);
  assert.equal(number(null), null);
  assert.equal(number('2.5'), 2.5);
});

test('startDate maps each period to a window start', () => {
  assert.equal(startDate('2026-10-03', '1M'), '2026-09-03');
  assert.equal(startDate('2026-10-03', '3M'), '2026-07-03');
  assert.equal(startDate('2026-10-03', '1Y'), '2025-10-03');
  assert.equal(startDate('2026-10-03', 'YTD'), '2026-01-01');
  assert.equal(startDate('2026-10-03', 'ALL'), '1900-01-01');
  assert.equal(startDate('2026-10-03', '1W'), '2026-09-26');
});

test('short and custom ranges open on the last snapshot on or before their first day', () => {
  const dates = ['2026-10-03', '2026-09-20', '2026-09-28', '2026-10-05'];
  // no snapshot on Sep 27: 1W opens on Sep 20, the last one before it
  assert.equal(openingDate('2026-09-27', '1W', dates), '2026-09-20');
  assert.equal(openingDate('2026-09-26', '1W', dates), '2026-09-20');
  assert.equal(openingDate('2026-10-03', 'CUSTOM', dates), '2026-10-03');
  // nothing before the start: it stays, and the chart begins at the first snapshot after it
  assert.equal(openingDate('2026-09-01', 'CUSTOM', dates), '2026-09-01');
  // the longer ranges keep their own start
  assert.equal(openingDate('2026-09-03', '1M', dates), '2026-09-03');
});

test('private mode masks your amounts and shares but never percentages or public prices', async () => {
  const { cash, shares, price, percent, setPrivateMode, isPrivate, MASK } =
    await import('../src/lib/format.ts');
  try {
    setPrivateMode(true);
    assert.ok(isPrivate());
    assert.equal(cash(1234.5), MASK);
    assert.equal(cash(1_250_000, true), MASK);
    assert.equal(shares(10.5), MASK);
    assert.equal(cash(null), '—'); // nothing to hide when there is no value
    assert.equal(price(286.42), '$286.42'); // a security's price is public
    assert.equal(percent(9.056), '+9.06%');
  } finally {
    setPrivateMode(false);
  }
  assert.equal(cash(1234.5), '$1,234.50');
  assert.equal(shares(10.5), '10.5');
});

test('share formats a part of a whole and is unavailable for an empty whole', () => {
  assert.equal(share(25, 100), '25.0%');
  assert.equal(share(1, 3), '33.3%');
  assert.equal(share(5, 0), '—');
});

test('chart tooltips say the year, axis labels do not', () => {
  assert.equal(dateLabel('2026-01-09'), 'Jan 9');
  assert.equal(dateLabelYear('2026-01-09'), 'Jan 9, 2026');
  assert.equal(dateLabelYear('2025-12-31'), 'Dec 31, 2025');
});
