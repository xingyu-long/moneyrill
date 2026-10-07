import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchYahooHistory, parseYahooChart } from '../server/services/benchmarks.ts';

// 2026-10-01 and 2026-10-02 09:30 New York time (UTC-4), as Yahoo reports them.
const open1 = Date.UTC(2026, 9, 1, 13, 30) / 1000,
  open2 = Date.UTC(2026, 9, 2, 13, 30) / 1000;

function chart(timestamps: number[], adjclose: (number | null)[]) {
  return {
    chart: {
      result: [
        {
          meta: { gmtoffset: -14400 },
          timestamp: timestamps,
          indicators: { adjclose: [{ adjclose }] },
        },
      ],
      error: null,
    },
  };
}

test('Yahoo chart parsing uses the exchange trading day and skips missing closes', () => {
  const rows = parseYahooChart(chart([open1, open2, open2 + 86400], [764.1, 769.64, null]), 'SPY');
  assert.deepEqual(rows, [
    { date: '2026-10-01', level: 764.1 },
    { date: '2026-10-02', level: 769.64 },
  ]);
});

test('Yahoo chart parsing rejects errors and unexpected shapes', () => {
  assert.throws(
    () => parseYahooChart({ chart: { result: null, error: { code: 'Not Found' } } }, 'NOPE'),
    /No chart data/,
  );
  assert.throws(
    () => parseYahooChart({ chart: { result: [{ timestamp: [open1], indicators: {} }] } }, 'SPY'),
    /Unexpected chart format/,
  );
});

test('history download fails on HTTP errors and suspiciously short series', async () => {
  const respond = (status: number, body: unknown) => async () =>
    new Response(JSON.stringify(body), { status });
  await assert.rejects(fetchYahooHistory('SPY', respond(429, {}) as any), /HTTP 429/);
  await assert.rejects(
    fetchYahooHistory('SPY', respond(200, chart([open1], [764.1])) as any),
    /Too little history/,
  );
  const days = Array.from({ length: 30 }, (_, i) => open1 + i * 86400);
  const rows = await fetchYahooHistory(
    'SPY',
    respond(
      200,
      chart(
        days,
        days.map((_, i) => 100 + i),
      ),
    ) as any,
  );
  assert.equal(rows.length, 30);
});
