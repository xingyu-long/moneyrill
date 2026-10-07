import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appearanceFlows,
  periodReturn,
  portfolioReturn,
  valueSeries,
  returnChart,
  benchmarkKey,
  withBenchmarks,
  returnStatus,
  type Flow,
} from '../src/lib/performance.ts';

const close = (actual: number | null, expected: number, digits = 9) =>
  assert.ok(
    actual !== null && Math.abs(actual - expected) < 10 ** -digits,
    `${actual} != ${expected}`,
  );

const DAY = 86400000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** One row per day from `from` to `to`, valued by `value(date)`. */
function daily(from: string, to: string, value: (date: string) => number) {
  const rows: { date: string; value: number }[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY) {
    const date = iso(t);
    rows.push({ date, value: value(date) });
  }
  return rows;
}

/** A portfolio that earns `growth` a day, with `flows` added on their days (after that day's growth). */
function simulate(from: string, to: string, start: number, growth: number, flows: Flow[]) {
  let value = start;
  return daily(from, to, (date) => {
    if (date > from) value *= 1 + growth;
    value += flows.filter((f) => f.date === date).reduce((s, f) => s + f.amount, 0);
    return value;
  });
}

test('a period return is the gain over the money at work (the worked example: 100 -> 200 with 50 added)', () => {
  // One day, flow on its last day: half-day weight, so the money at work is 100 + 50 * 0.5.
  const p = periodReturn('2026-03-01', '2026-03-02', 100, 200, [
    { date: '2026-03-02', amount: 50 },
  ]);
  assert.equal(p.gain, 50);
  assert.equal(p.flow, 50);
  close(p.ret, 50 / 125);
});

test('money added with no growth is not a gain', () => {
  const p = periodReturn('2026-03-01', '2026-03-31', 1000, 1500, [
    { date: '2026-03-15', amount: 500 },
  ]);
  assert.equal(p.gain, 0);
  assert.equal(p.ret, 0);
});

test('a flow counts for the share of the period it was in the account', () => {
  const early = periodReturn('2026-03-01', '2026-03-31', 100, 160, [
    { date: '2026-03-02', amount: 50 },
  ]);
  const late = periodReturn('2026-03-01', '2026-03-31', 100, 160, [
    { date: '2026-03-30', amount: 50 },
  ]);
  // The same 10 gained, but money added early had longer to earn it, so its return is smaller.
  assert.equal(early.gain, 10);
  assert.equal(late.gain, 10);
  assert.ok(early.ret! < late.ret!);
  close(early.ret, 10 / (100 + 50 * (29.5 / 30)));
  close(late.ret, 10 / (100 + 50 * (1.5 / 30)));
});

test('several flows are weighted one by one; withdrawals are negative; flows outside the period are ignored', () => {
  const p = periodReturn('2026-03-01', '2026-03-31', 1000, 840, [
    { date: '2026-03-31', amount: -200 },
    { date: '2026-03-11', amount: 100 },
    { date: '2026-03-21', amount: -50 },
    { date: '2026-03-01', amount: 999 }, // the start day is already in the start value
    { date: '2026-02-20', amount: 999 },
    { date: '2026-04-02', amount: 999 },
  ]);
  assert.equal(p.flow, -150);
  assert.equal(p.gain, -10);
  close(p.ret, -10 / (1000 + (-200 * (0.5 / 30) + 100 * (20.5 / 30) + -50 * (10.5 / 30))));
});

test('with no cash flows the return is just the balance change', () => {
  const p = periodReturn('2026-03-01', '2026-03-31', 1000, 1100, []);
  assert.equal(p.gain, 100);
  assert.equal(p.ret, 0.1);
});

test('no money at work means no return', () => {
  assert.equal(periodReturn('2026-03-01', '2026-03-31', 0, 50, []).ret, null);
  assert.equal(
    periodReturn('2026-03-01', '2026-03-31', 100, 0, [{ date: '2026-03-10', amount: -300 }]).ret,
    null,
  );
});

test('with no cash flows the chained return is the balance change, however long the span', () => {
  const history = daily(
    '2025-12-31',
    '2026-06-30',
    (date) => 100 + (Date.parse(date) - Date.parse('2025-12-31')) / DAY,
  );
  const r = portfolioReturn(history, [], '2026-01-01')!;
  assert.equal(r.from, '2025-12-31');
  assert.equal(r.to, '2026-06-30');
  close(r.ret, history[history.length - 1].value / 100 - 1, 6);
  assert.equal(r.periods.length, 6);
});

test('the opening day says which limit decided it: the range, the first balance or the cash-flow start', () => {
  const history = daily('2025-03-10', '2026-06-30', () => 100);
  assert.equal(portfolioReturn(history, [], '2026-01-01')!.limit, 'range');
  assert.equal(portfolioReturn(history, [], '2020-01-01')!.limit, 'balance');
  assert.equal(portfolioReturn(history, [], '2026-01-01')!.from, '2025-12-31');
  // flows known only from Feb 1: the span opens on Jan 31 whatever the range
  const late = portfolioReturn(history, [], '2026-01-01', '2026-02-01')!;
  assert.equal(late.limit, 'flows');
  assert.equal(late.from, '2026-01-31');
  // a cash-flow start before the range changes nothing
  assert.equal(portfolioReturn(history, [], '2026-01-01', '2025-06-01')!.limit, 'range');
});

test('the chart series starts on the opening day, not on the range start', () => {
  const history = daily('2025-12-20', '2026-03-10', (date) => 100 + Date.parse(date) / DAY / 1000);
  const r = portfolioReturn(history, [], '2026-01-01', '2026-02-01')!;
  const series = valueSeries(r);
  assert.equal(series[0].date, '2026-01-31');
  assert.equal(series[0].value, r.startValue);
  assert.equal(series[series.length - 1].date, '2026-03-10');
  assert.ok(series.every((p) => p.date >= '2026-01-31'));
});

test('it recovers the underlying growth whatever is deposited or withdrawn', () => {
  // 0.1% a day. Large deposits and withdrawals, one of them half the balance, in different months.
  const growth = 0.001;
  const flows: Flow[] = [
    { date: '2026-01-05', amount: 40 },
    { date: '2026-02-12', amount: 120 },
    { date: '2026-02-27', amount: -60 },
    { date: '2026-03-31', amount: 300 },
    { date: '2026-04-15', amount: -150 },
    { date: '2026-05-20', amount: 500 },
  ];
  const history = simulate('2025-12-31', '2026-06-30', 100, growth, flows);
  const r = portfolioReturn(history, flows, '2026-01-01')!;
  const days = history.length - 1;
  // The balance more than quadrupled, but the portfolio only earned 0.1% a day.
  assert.ok(history[history.length - 1].value > 4 * 100);
  // Modified Dietz assumes a flow earns evenly, so it is close to, not exactly, the true rate: within 0.3 points.
  assert.ok(Math.abs(r.ret! - ((1 + growth) ** days - 1)) < 0.003, `${r.ret}`);
  for (const p of r.periods) {
    const exact = (1 + growth) ** ((Date.parse(p.end) - Date.parse(p.start)) / DAY) - 1;
    assert.ok(Math.abs(p.ret! - exact) < 0.003, `${p.start}: ${p.ret} vs ${exact}`);
  }
  // The same flows left in as growth would have made it look far larger.
  assert.ok(history[history.length - 1].value / 100 - 1 > 3);
});

test('a deposit in one month does not change another month', () => {
  const growth = 0.002;
  const flows: Flow[] = [{ date: '2026-02-10', amount: 1000 }];
  const withDeposit = portfolioReturn(
    simulate('2025-12-31', '2026-03-31', 100, growth, flows),
    flows,
    '2026-01-01',
  )!;
  const without = portfolioReturn(
    simulate('2025-12-31', '2026-03-31', 100, growth, []),
    [],
    '2026-01-01',
  )!;
  close(withDeposit.periods[0].ret, without.periods[0].ret!, 9); // January, before it
  close(withDeposit.periods[2].ret, without.periods[2].ret!, 6); // March, after it
});

test('months are chained, and the weights come from the dated flows', () => {
  // 100 at the end of 2025, +10% in January, then 100 deposited on Feb 10 and 10 of growth by Feb 28.
  const history = daily('2025-12-31', '2026-02-28', (date) =>
    date <= '2026-01-31'
      ? 100 + (10 * (Date.parse(date) - Date.parse('2025-12-31'))) / (31 * DAY)
      : date < '2026-02-10'
        ? 110
        : 110 + 100 + (10 * (Date.parse(date) - Date.parse('2026-02-10'))) / (18 * DAY),
  );
  const flows = [{ date: '2026-02-10', amount: 100 }];
  const r = portfolioReturn(history, flows, '1900-01-01')!;
  assert.equal(r.from, '2025-12-31');
  assert.equal(r.periods.length, 2);
  close(r.periods[0].ret, 0.1, 6);
  const february = 10 / (110 + 100 * ((18 + 0.5) / 28));
  close(r.periods[1].ret, february, 6);
  close(r.ret, 1.1 * (1 + february) - 1, 6);
  assert.equal(r.startValue, 100);
  assert.equal(r.endValue, 220);
  close(r.flow, 100);
  close(r.gain, 20, 6);
  // The balance rose 120%; the line starts at zero and ends on the chained return.
  assert.equal(r.points[0].portfolio, 0);
  close(r.points[r.points.length - 1].portfolio, r.ret! * 100, 6);
});

test('the line inside a month shows the return so far, and meets the month end', () => {
  const history = daily('2025-12-31', '2026-01-31', (date) => (date < '2026-01-31' ? 100 : 105));
  const r = portfolioReturn(history, [], '2026-01-01')!;
  assert.equal(r.points.find((p) => p.date === '2026-01-15')!.portfolio, 0);
  close(r.points[r.points.length - 1].portfolio, 5, 9);
  // Every balance day has a point, plus the opening.
  assert.equal(r.points.length, history.length);
});

test('the latest month can be partial', () => {
  const history = daily('2026-02-01', '2026-03-10', (date) => (date >= '2026-03-05' ? 130 : 100));
  const r = portfolioReturn(history, [{ date: '2026-03-02', amount: 20 }], '2026-03-01')!;
  assert.equal(r.from, '2026-02-28');
  assert.equal(r.to, '2026-03-10');
  // 130 - 100 - 20 = 10 gained on 100 + 20 * (8.5 / 10) at work.
  close(r.ret, 10 / (100 + 20 * 0.85));
});

test('a range opens at the month end before it', () => {
  const history = daily('2025-12-01', '2026-03-31', () => 100);
  assert.equal(portfolioReturn(history, [], '2026-02-10')!.from, '2026-01-31');
  assert.equal(portfolioReturn(history, [], '2026-02-01')!.from, '2026-01-31');
  // Starting on the last day of a month includes that day, so the span opens at the end of the month before.
  assert.equal(portfolioReturn(history, [], '2026-01-31')!.from, '2025-12-31');
});

test('a range that starts before the balances opens at the first balance, even mid-month', () => {
  const history = daily('2026-01-17', '2026-03-10', () => 100);
  const r = portfolioReturn(history, [], '1900-01-01')!;
  assert.equal(r.from, '2026-01-17');
  assert.equal(r.periods.length, 3); // the rest of January, February, March so far
  assert.equal(r.periods[0].start, '2026-01-17');
  assert.equal(r.periods[0].end, '2026-01-31');
});

test('the span never starts before the day cash flows are known from', () => {
  // Balances start in January, but cash flows are only recorded from Mar 1: a deposit before then must not count.
  const flows: Flow[] = [{ date: '2026-03-10', amount: 100 }];
  const history = simulate('2026-01-01', '2026-05-31', 100, 0.001, [
    { date: '2026-02-05', amount: 500 },
    ...flows,
  ]);
  const all = portfolioReturn(history, flows, '1900-01-01', '2026-03-01')!;
  assert.equal(all.from, '2026-02-28');
  assert.equal(all.periods[0].start, '2026-02-28');
  // Counting from the first balance would read the February deposit as growth.
  const unclamped = portfolioReturn(history, flows, '1900-01-01')!;
  assert.ok(unclamped.ret! > all.ret! + 1);
  // A range that starts later is not moved; one that starts earlier is cut to the date.
  assert.equal(portfolioReturn(history, flows, '2026-04-10', '2026-03-01')!.from, '2026-03-31');
  assert.equal(portfolioReturn(history, flows, '2026-01-10', '2026-03-01')!.from, '2026-02-28');
  // With no date the first balance is the limit.
  assert.equal(portfolioReturn(history, flows, '1900-01-01', null)!.from, '2026-01-01');
});

test('a date in the middle of a month opens on the day before it, with a partial first month', () => {
  const history = simulate('2026-01-01', '2026-04-10', 100, 0.001, []);
  const r = portfolioReturn(history, [], '1900-01-01', '2026-02-16')!;
  assert.equal(r.from, '2026-02-15');
  assert.equal(r.periods[0].start, '2026-02-15');
  assert.equal(r.periods[0].end, '2026-02-28');
});

test('a date after the latest balance leaves nothing to show', () => {
  const history = daily('2026-01-01', '2026-03-10', () => 100);
  assert.equal(portfolioReturn(history, [], '1900-01-01', '2026-03-15'), null);
});

test('there is no return without a day after the start or any known balance', () => {
  assert.equal(portfolioReturn([], [], '2026-01-01'), null);
  assert.equal(portfolioReturn([{ date: '2026-01-31', value: 100 }], [], '2026-01-01'), null);
  assert.equal(
    portfolioReturn(
      [
        { date: '2026-01-31', value: null },
        { date: '2026-02-01', value: null },
      ],
      [],
      '2026-01-01',
    ),
    null,
  );
});

test('days with an unknown total are skipped, not read as zero', () => {
  const history = daily('2025-12-31', '2026-01-31', () => 100).map((r) =>
    r.date === '2026-01-10' ? { date: r.date, value: null } : r,
  );
  const r = portfolioReturn(history, [], '2026-01-01')!;
  assert.ok(r.points.every((p) => p.date !== '2026-01-10'));
  close(r.ret, 0);
});

test('an account that appears later brings its balance in as a deposit', () => {
  const flows = appearanceFlows(
    [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    [
      { account_id: 'a', date: '2026-01-01', current_balance: '100' },
      { account_id: 'a', date: '2026-01-02', current_balance: '101' },
      { account_id: 'b', date: '2026-01-07', current_balance: '50' },
      { account_id: 'c', date: '2026-02-01', current_balance: null },
      { account_id: 'x', date: '2026-03-01', current_balance: '999' },
    ],
  );
  assert.deepEqual(flows, [{ date: '2026-01-07', amount: 50 }]);
  assert.deepEqual(appearanceFlows([], []), []);
  // It is taken out of that month's gain: 100 became 150 only because 50 arrived on Jan 7.
  const history = daily('2025-12-31', '2026-01-31', (d) => (d >= '2026-01-07' ? 150 : 100));
  assert.equal(portfolioReturn(history, flows, '2026-01-01')!.gain, 0);
});

test('the benchmark line starts at zero on the same first date', () => {
  const rows = returnChart(
    [
      { date: '2026-01-01', value: 100, portfolio: 0 },
      { date: '2026-01-03', value: 110, portfolio: 10 },
    ],
    [
      { symbol: 'SPY', date: '2025-12-31', level: '200', provenance: 'x' },
      { symbol: 'SPY', date: '2026-01-02', level: '210', provenance: 'x' },
    ],
  );
  assert.deepEqual(
    rows.map((r) => r.date),
    ['2026-01-01', '2026-01-03'],
  );
  assert.equal(rows[0].benchmark, 0);
  close(rows[1].benchmark, 5);
  assert.equal(rows[1].portfolio, 10);
});

test('the status says why the return is not shown', () => {
  const history = daily('2026-01-01', '2026-03-10', () => 100);
  const result = portfolioReturn(history, [], '1900-01-01')!;
  const base = {
    wholePortfolio: true,
    flowsLoaded: true,
    flowsFrom: '2026-01-15',
    lastBalanceDate: '2026-03-10',
    result: null,
  };
  assert.equal(returnStatus({ ...base, result }), 'ok');
  assert.equal(returnStatus({ ...base, wholePortfolio: false }), 'accounts');
  assert.equal(returnStatus({ ...base, flowsLoaded: false }), 'unloaded');
  // A day after the latest balance leaves no span; the day after the last balance is already too late, the day of it is not.
  assert.equal(returnStatus({ ...base, flowsFrom: '2026-03-11' }), 'late');
  assert.equal(returnStatus({ ...base, flowsFrom: '2026-03-10' }), 'nobase');
  assert.equal(returnStatus({ ...base, flowsFrom: null }), 'nobase');
  // A late date really does leave nothing to show.
  assert.equal(portfolioReturn(history, [], '1900-01-01', '2026-03-11'), null);
  // The order of the checks: not all accounts wins over a late date.
  assert.equal(
    returnStatus({ ...base, wholePortfolio: false, flowsFrom: '2026-03-11' }),
    'accounts',
  );
});

test('every benchmark becomes its own column, each rebased to zero on its first level in the range', () => {
  const obs = (symbol: string, date: string, level: string) => ({
    symbol,
    date,
    level,
    provenance: 'x',
  });
  const all = [
    obs('SPY', '2026-10-01', '100'),
    obs('SPY', '2026-10-02', '110'),
    obs('SPY', '2026-10-04', '121'),
    obs('US bonds', '2026-10-02', '50'),
    obs('US bonds', '2026-10-04', '45'),
  ];
  const rows = [
    { date: '2026-10-02', portfolio: 0 },
    { date: '2026-10-03', portfolio: 1 },
    { date: '2026-10-04', portfolio: 2 },
  ];
  const out = withBenchmarks(rows, all, ['SPY', 'US bonds'], '2026-10-02');
  assert.deepEqual(
    out.map((r) => [
      r.date,
      r.portfolio,
      Math.round(r[benchmarkKey('SPY')]! * 1e6) / 1e6,
      Math.round(r[benchmarkKey('US bonds')]! * 1e6) / 1e6,
    ]),
    [
      ['2026-10-02', 0, 0, 0], // each starts at zero on its first level
      ['2026-10-03', 1, 0, 0], // carried over the weekend
      ['2026-10-04', 2, 10, -10],
    ],
  );
  assert.equal(benchmarkKey('US total market'), 'bm:US total market');
});

test('a benchmark without data in the range is a column of nulls, and none at all adds no columns', () => {
  const rows = [{ date: '2026-10-02', portfolio: 0 }];
  assert.equal(withBenchmarks(rows, [], ['SPY'], '2026-10-02')[0][benchmarkKey('SPY')], null);
  assert.deepEqual(withBenchmarks(rows, [], [], '2026-10-02'), rows);
});
