import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooCloses, yahooSymbol } from '../server/lib/prices.ts';

test('Yahoo symbols: plain tickers only, upper-cased, a class dot becomes a dash', () => {
  assert.equal(yahooSymbol('voo'), 'VOO');
  assert.equal(yahooSymbol(' BRK.B '), 'BRK-B');
  assert.equal(yahooSymbol('FDRXX'), 'FDRXX');
  for (const bad of [
    '',
    '   ',
    null,
    undefined,
    'CUR:USD',
    'NOT A TICKER',
    'TOOLONGSYMBOLX',
    '$VOO',
    '../x',
  ])
    assert.equal(yahooSymbol(bad as any), null, String(bad));
});

const chart = (over: any = {}) => ({
  chart: {
    result: [
      {
        meta: { gmtoffset: -14400 },
        // 2026-10-01 and 2026-10-02 at 13:30 UTC (09:30 New York), then a day with no close
        timestamp: [1790861400, 1790947800, 1791034200],
        indicators: {
          quote: [{ close: [100.5, 101.25, null] }],
          adjclose: [{ adjclose: [90, 91, 92] }],
        },
        ...over,
      },
    ],
  },
});

test('closes are the plain close on the exchange day, not the adjusted one; days without a close are skipped', () => {
  assert.deepEqual(parseYahooCloses(chart(), 'X'), [
    { date: '2026-10-01', close: 100.5 },
    { date: '2026-10-02', close: 101.25 },
  ]);
});

test('closes that are not positive numbers are skipped, and rows come out in date order', () => {
  const body = chart({
    timestamp: [1790947800, 1790861400, 1791034200],
    indicators: { quote: [{ close: [101, 0, -3] }] },
  });
  assert.deepEqual(parseYahooCloses(body, 'X'), [{ date: '2026-10-02', close: 101 }]);
});

test('an error or an unexpected shape is refused, naming the symbol', () => {
  assert.throws(() => parseYahooCloses({ chart: { result: null } }, 'ZZZ'), /ZZZ/);
  assert.throws(() => parseYahooCloses({}, 'ZZZ'), /No chart data/);
  assert.throws(
    () => parseYahooCloses(chart({ indicators: { quote: [{}] } }), 'ZZZ'),
    /Unexpected chart format/,
  );
});
