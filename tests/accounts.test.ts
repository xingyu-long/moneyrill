import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account } from '../src/types.ts';
import {
  visibleAccounts,
  searchAccounts,
  summarizeNetWorth,
  lastBalanceDate,
  balanceEditable,
  holdingsEditable,
} from '../src/lib/accounts.ts';
import { availableBenchmarks, benchmarkSeries, performanceSeries } from '../src/lib/performance.ts';

const acct = (
  id: string,
  kind: string,
  balance: string | null,
  source = 'manual',
  name = id,
): Account => ({
  id,
  name,
  institution: 'Inst',
  kind,
  currency: 'USD',
  mask: '',
  included: true,
  source,
  balance,
  balance_date: '',
  last_synced: '',
  last_error: null,
  provider_as_of: null,
  holdings_as_of: null,
});

test('production hides demo and sandbox data; staging picks one set', () => {
  const list = [
    acct('s', 'cash', '1', 'simulated'),
    acct('p', 'cash', '1', 'plaid_sandbox'),
    acct('r', 'cash', '1', 'plaid_production'),
  ];
  assert.deepEqual(
    visibleAccounts(list, true, 'simulated').map((a) => a.id),
    ['r'],
  );
  assert.deepEqual(
    visibleAccounts(list, false, 'simulated').map((a) => a.id),
    ['s'],
  );
  assert.deepEqual(
    visibleAccounts(list, false, 'connected').map((a) => a.id),
    ['p', 'r'],
  );
});

test('search matches name or institution case-insensitively', () => {
  const list = [
    acct('1', 'cash', '1', 'manual', 'Joint Checking'),
    acct('2', 'cash', '1', 'manual', 'HSA'),
  ];
  assert.deepEqual(
    searchAccounts(list, 'checking').map((a) => a.id),
    ['1'],
  );
  assert.equal(searchAccounts(list, 'INST').length, 2);
});

test('net worth is assets minus debts, keeping credit signs', () => {
  const s = summarizeNetWorth([
    acct('i', 'investment', '100000'),
    acct('c', 'cash', '30000'),
    acct('d', 'credit', '3000'),
    acct('x', 'credit', '-25'),
  ]);
  assert.equal(s.assets, 130000);
  assert.equal(s.liabilities, 2975);
  assert.equal(s.net, 127025);
  assert.equal(summarizeNetWorth([acct('n', 'cash', null)]).net, 0);
});

test('latest balance date falls back to today', () => {
  assert.equal(
    lastBalanceDate([
      { account_id: 'a', date: '2026-10-01', current_balance: '1', provenance: '' },
      { account_id: 'a', date: '2026-10-03', current_balance: '1', provenance: '' },
    ]),
    '2026-10-03',
  );
  assert.match(lastBalanceDate([]), /^\d{4}-\d{2}-\d{2}$/);
});

test('performance rebases portfolio and benchmark to the first point', () => {
  const bench = [
    { symbol: 'X', date: '2026-10-01', level: '100', provenance: '' },
    { symbol: 'X', date: '2026-10-02', level: '110', provenance: '' },
    { symbol: 'Y', date: '2026-10-02', level: '999', provenance: '' },
  ];
  const series = benchmarkSeries(bench, 'X', '2026-10-01');
  assert.equal(series.length, 2);
  const perf = performanceSeries(
    [
      { date: '2026-10-01', value: 200 },
      { date: '2026-10-02', value: 210 },
      { date: '2026-10-03', value: null },
    ],
    series,
    200,
  );
  assert.equal(perf[0].portfolio, 0);
  assert.ok(Math.abs(perf[1].portfolio! - 5) < 1e-9);
  assert.ok(Math.abs(perf[1].benchmark! - 10) < 1e-9);
  assert.equal(perf[2].portfolio, null);
  // No close on 10-03 (e.g. a weekend): the 10-02 level carries forward.
  assert.ok(Math.abs(perf[2].benchmark! - 10) < 1e-9);
});

test('benchmark series starts from the last close before a non-trading start date', () => {
  const bench = [
    { symbol: 'X', date: '2026-09-25', level: '100', provenance: '' },
    { symbol: 'X', date: '2026-09-26', level: '105', provenance: '' },
    { symbol: 'X', date: '2026-09-29', level: '126', provenance: '' },
  ];
  // Portfolio history starts on Sunday 09-27; the benchmark base is Friday's close.
  const series = benchmarkSeries(bench, 'X', '2026-09-27');
  assert.deepEqual(
    series.map((b) => b.date),
    ['2026-09-26', '2026-09-29'],
  );
  const perf = performanceSeries(
    [
      { date: '2026-09-27', value: 100 },
      { date: '2026-09-28', value: 100 },
      { date: '2026-09-29', value: 100 },
    ],
    series,
    100,
  );
  assert.deepEqual(
    perf.map((p) => Math.round(p.benchmark! * 1e9) / 1e9),
    [0, 0, 20],
  );
  assert.equal(benchmarkSeries(bench, 'Y', '2026-09-27').length, 0);
});

test('real benchmarks are always offered; simulated ones only in the demo', () => {
  const rows = ['SPY', 'QQQ', 'US large cap'].map((symbol) => ({
    symbol,
    date: '2026-10-01',
    level: '1',
    provenance: '',
  }));
  assert.deepEqual(
    availableBenchmarks(rows, false).map((o) => o.symbol),
    ['SPY', 'QQQ'],
  );
  assert.deepEqual(
    availableBenchmarks(rows, true).map((o) => o.symbol),
    ['SPY', 'QQQ', 'US large cap'],
  );
  assert.deepEqual(availableBenchmarks([], false), []);
});

const held = (account_id: string, date: string, provenance = 'plaid_production') => ({
  account_id,
  security_id: 's',
  date,
  quantity: '1',
  price: '1',
  value: '1',
  cost_basis: null,
  symbol: 'X',
  name: 'X',
  asset_class: 'Equities',
  provenance,
});

test('only an account you keep by hand has a balance you can type', () => {
  assert.equal(balanceEditable(acct('a', 'cash', '1', 'manual')), true);
  for (const source of ['plaid_production', 'plaid_sandbox', 'simulated', 'imported'])
    assert.equal(balanceEditable(acct('a', 'cash', '1', source)), false);
});

test('holdings can be typed in only where the provider gives none', () => {
  const synced = {
    ...acct('b', 'investment', '10', 'plaid_production'),
    holdings_as_of: '2026-10-03',
  };
  // manual investment accounts: always
  assert.equal(holdingsEditable(acct('m', 'investment', '10', 'manual'), []), true);
  // not an investment account
  assert.equal(holdingsEditable(acct('c', 'cash', '10', 'manual'), []), false);
  // synced, with holdings at the latest date: no
  assert.equal(holdingsEditable(synced, [held('b', '2026-10-03')]), false);
  // synced, and the latest day has none (a brokerage): yes
  assert.equal(holdingsEditable(synced, []), true);
  assert.equal(holdingsEditable(synced, [held('b', '2026-09-01')]), true);
  // holdings typed in earlier do not count as synced ones
  assert.equal(holdingsEditable(synced, [held('b', '2026-10-03', 'manual')]), true);
  // another account's holdings are not this account's
  assert.equal(holdingsEditable(synced, [held('other', '2026-10-03')]), true);
});

test('without a latest holdings date, any synced holding counts', () => {
  const noDate = acct('b', 'investment', '10', 'plaid_production');
  assert.equal(holdingsEditable(noDate, [held('b', '2026-09-01')]), false);
});
