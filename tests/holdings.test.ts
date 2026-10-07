import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account, Holding } from '../src/types.ts';
import {
  buildHoldingRows,
  aggregatePositions,
  sortPositions,
  nextSort,
  buildSecurityDetail,
  allocate,
} from '../src/lib/holdings.ts';

const account = (
  id: string,
  name: string,
  balance: string | null,
  asOf = '2026-10-03',
): Account => ({
  id,
  name,
  institution: 'Test',
  kind: 'investment',
  currency: 'USD',
  mask: '0000',
  included: true,
  source: 'manual',
  balance,
  balance_date: asOf,
  last_synced: '',
  last_error: null,
  provider_as_of: null,
  holdings_as_of: asOf,
});
const holding = (
  account_id: string,
  symbol: string,
  date: string,
  quantity: string | null,
  price: string | null,
  value: string | null,
  cost_basis: string | null = null,
  asset_class = 'Equities',
): Holding => ({
  account_id,
  security_id: `${account_id}:${symbol}`,
  date,
  quantity,
  price,
  value,
  cost_basis,
  symbol,
  name: `${symbol} Inc.`,
  asset_class,
  provenance: 'manual',
});

const a = account('a', 'Brokerage', '1000');
const b = account('b', 'Roth', '600');
const holdings: Holding[] = [
  holding('a', 'VTI', '2026-09-03', '10', '90', '900', '800'),
  holding('a', 'VTI', '2026-10-03', '10', '100', '1000', '800'),
  holding('b', 'VTI', '2026-10-03', '5', '100', '500', '400'),
  holding('b', 'CASH', '2026-10-03', '100', '1', '100', null, 'Cash'),
];

test('rows use only the latest holdings date and compute price change', () => {
  const rows = buildHoldingRows([a, b], holdings, '2026-09-01');
  const vtiA = rows.find((r) => r.account_id === 'a' && r.symbol === 'VTI')!;
  assert.equal(vtiA.value, 1000);
  assert.ok(Math.abs(vtiA.change! - 11.111111111111111) < 1e-9);
  assert.equal(rows.filter((r) => r.account_id === 'a').length, 1);
});

test('a balance the holdings do not explain becomes an Unreported row', () => {
  const short = account('c', 'Empty', '150318');
  const rows = buildHoldingRows([short], [], '2026-09-01');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].asset_class, 'Unreported');
  assert.equal(rows[0].value, 150318);
  assert.equal(
    buildHoldingRows(
      [account('d', 'Exact', '100')],
      [holding('d', 'X', '2026-10-03', '1', '100', '100')],
      'x',
    ).length,
    1,
  );
});

test('the same security is summed across accounts; cost basis is unknown if any is missing', () => {
  const rows = buildHoldingRows([a, b], holdings, '2026-09-01');
  const positions = aggregatePositions(rows);
  const vti = positions.find((p) => p.symbol === 'VTI')!;
  assert.equal(vti.quantity, 15);
  assert.equal(vti.value, 1500);
  assert.equal(vti.cost_basis, 1200);
  assert.equal(vti.accountName, null);
  assert.equal(positions.length, 2);
  const noBasis = aggregatePositions(
    buildHoldingRows(
      [a, b],
      [
        holding('a', 'X', '2026-10-03', '1', '1', '1', '1'),
        holding('b', 'X', '2026-10-03', '1', '1', '1', null),
      ],
      'x',
    ),
  );
  assert.equal(noBasis.find((p) => p.symbol === 'X')!.cost_basis, null);
});

test('unreported rows are not merged across accounts', () => {
  const positions = aggregatePositions(
    buildHoldingRows([account('c', 'One', '10'), account('d', 'Two', '20')], [], 'x'),
  );
  assert.equal(positions.length, 2);
  assert.deepEqual(positions.map((p) => p.accountName).sort(), ['One', 'Two']);
});

test('sorting flips direction and always puts missing values last', () => {
  const positions = aggregatePositions(buildHoldingRows([a, b], holdings, '2026-09-01'));
  assert.deepEqual(
    sortPositions(positions, { key: 'value', dir: 'desc' }).map((p) => p.symbol),
    ['VTI', 'CASH'],
  );
  assert.deepEqual(
    sortPositions(positions, { key: 'value', dir: 'asc' }).map((p) => p.symbol),
    ['CASH', 'VTI'],
  );
  assert.deepEqual(
    sortPositions(positions, { key: 'cost_basis', dir: 'desc' }).map((p) => p.symbol),
    ['VTI', 'CASH'],
  );
  assert.deepEqual(
    sortPositions(positions, { key: 'cost_basis', dir: 'asc' }).map((p) => p.symbol),
    ['VTI', 'CASH'],
  );
  assert.deepEqual(
    sortPositions(positions, { key: 'symbol', dir: 'asc' }).map((p) => p.symbol),
    ['CASH', 'VTI'],
  );
});

test('clicking headers toggles direction; new columns start sensible', () => {
  assert.deepEqual(nextSort({ key: 'value', dir: 'desc' }, 'value'), { key: 'value', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'value', dir: 'desc' }, 'symbol'), {
    key: 'symbol',
    dir: 'asc',
  });
  assert.deepEqual(nextSort({ key: 'symbol', dir: 'asc' }, 'price'), { key: 'price', dir: 'desc' });
});

test('security detail sums accounts and builds a price series rebased to zero', () => {
  const rows = buildHoldingRows([a, b], holdings, '2026-09-01');
  const d = buildSecurityDetail('VTI', rows, holdings, new Set(['a', 'b']), '2026-09-01')!;
  assert.equal(d.quantity, 15);
  assert.equal(d.value, 1500);
  assert.equal(d.accounts.length, 2);
  assert.equal(d.points.length, 2);
  assert.equal(d.points[0].change, 0);
  assert.ok(Math.abs(d.points[1].change! - 11.1111111) < 1e-5);
  assert.equal(d.amount, 10);
  assert.equal(buildSecurityDetail(null, rows, holdings, new Set(['a']), 'x'), null);
  assert.equal(buildSecurityDetail('NOPE', rows, holdings, new Set(['a']), 'x'), null);
});

test('single-account detail ignores other accounts', () => {
  const rows = buildHoldingRows([b], holdings, '2026-09-01');
  const d = buildSecurityDetail('VTI', rows, holdings, new Set(['b']), '2026-09-01')!;
  assert.equal(d.quantity, 5);
  assert.equal(d.accounts.length, 1);
});

test('allocation groups by security, asset class or account, largest first', () => {
  const rows = buildHoldingRows([a, b], holdings, '2026-09-01');
  assert.deepEqual(allocate(rows, 'security'), [
    { name: 'VTI', value: 1500 },
    { name: 'CASH', value: 100 },
  ]);
  assert.deepEqual(
    allocate(rows, 'asset').map((x) => x.name),
    ['Equities', 'Cash'],
  );
  assert.deepEqual(
    allocate(rows, 'account').map((x) => x.name),
    ['Brokerage', 'Roth'],
  );
});

// --- Prices downloaded per ticker: Yahoo wins over the price the bank sent ---
const close = (symbol: string, date: string, c: string) => ({ symbol, date, close: c });
const vti = [
  close('VTI', '2026-09-03', '95'),
  close('VTI', '2026-10-01', '105'),
  close('VTI', '2026-10-03', '110'),
];

test('a ticker with closes is shown at the latest close, the same in every account', () => {
  const rows = buildHoldingRows([a, b], holdings, '2026-09-01', vti).filter(
    (r) => r.symbol === 'VTI',
  );
  assert.deepEqual(
    rows.map((r) => [r.account_id, r.price, r.value, r.priceDate]),
    [
      ['a', 110, 1100, '2026-10-03'],
      ['b', 110, 550, '2026-10-03'],
    ],
  );
});

test('the change runs from the first close in the range to the latest close', () => {
  const at = (start: string) =>
    buildHoldingRows([a], holdings, start, vti).find((r) => r.symbol === 'VTI')!.change;
  assert.equal(Math.round(at('2026-09-01')! * 100) / 100, 15.79); // 95 -> 110
  assert.equal(Math.round(at('2026-09-20')! * 100) / 100, 4.76); // 105 -> 110
  assert.equal(at('2026-10-03'), null); // only one close in the range
});

test('a ticker without closes keeps the price the bank sent', () => {
  const rows = buildHoldingRows([b], holdings, '2026-09-01', vti);
  const cash = rows.find((r) => r.symbol === 'CASH')!;
  assert.equal(cash.price, 1);
  assert.equal(cash.value, 100);
  assert.equal(cash.priceDate, undefined);
  assert.deepEqual(
    buildHoldingRows([a], holdings, '2026-09-01', []),
    buildHoldingRows([a], holdings, '2026-09-01'),
  );
});

test('the demo accounts keep their own prices', () => {
  const demo = { ...a, source: 'simulated' };
  const row = buildHoldingRows([demo], holdings, '2026-09-01', vti)[0];
  assert.equal(row.price, 100);
  assert.equal(row.priceDate, undefined);
});

test('unreported value is measured against what the bank reported, not against the new prices', () => {
  // The bank's own values add up to the balance exactly; a different market price must not invent a remainder.
  const exact = account('x', 'Exact', '1000');
  const rows = buildHoldingRows(
    [exact],
    [holding('x', 'VTI', '2026-10-03', '10', '100', '1000')],
    '2026-09-01',
    [close('VTI', '2026-10-03', '110')],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 1100);
  // A real gap is still reported, at the size the bank's values leave.
  const gap = buildHoldingRows(
    [account('y', 'Gap', '1500')],
    [holding('y', 'VTI', '2026-10-03', '10', '100', '1000')],
    '2026-09-01',
    [close('VTI', '2026-10-03', '110')],
  );
  const unreported = gap.find((r) => r.asset_class === 'Unreported')!;
  assert.equal(unreported.value, 500);
});

test('the security detail charts the downloaded closes, one history for every account', () => {
  const rows = buildHoldingRows([a, b], holdings, '2026-09-01', vti);
  const d = buildSecurityDetail('VTI', rows, holdings, new Set(['a', 'b']), '2026-09-01', vti)!;
  assert.deepEqual(
    d.points.map((p) => p.date),
    ['2026-09-03', '2026-10-01', '2026-10-03'],
  );
  assert.equal(d.price, 110);
  assert.equal(Math.round(d.change! * 100) / 100, 15.79);
  // Without closes it falls back to the prices the bank sent on each day.
  const old = buildSecurityDetail('VTI', rows, holdings, new Set(['a', 'b']), '2026-09-01')!;
  assert.deepEqual(
    old.points.map((p) => p.date),
    ['2026-09-03', '2026-10-03'],
  );
});

// --- The balance priced at the latest closes: the table adds up to it, and "unreported" stays the bank's ---
test('with the balance priced at closes, the rows add up to the balance and nothing is unreported', () => {
  // The bank reports 1000 (10 x 100); at the close of 110 the holdings are worth 1100 and the balance says so.
  const priced = { ...account('p', 'Priced', '1100'), balance_adjustment: '100' };
  const rows = buildHoldingRows(
    [priced],
    [holding('p', 'VTI', '2026-10-03', '10', '100', '1000')],
    '2026-09-01',
    [close('VTI', '2026-10-03', '110')],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 1100);
  assert.equal(
    rows.reduce((s, r) => s + (r.value ?? 0), 0),
    1100,
  );
});

test("a real gap is still the bank's: cash the holdings do not list stays unreported at its own size", () => {
  const priced = { ...account('p', 'Priced', '1600'), balance_adjustment: '100' }; // bank: 1500, 500 not listed
  const rows = buildHoldingRows(
    [priced],
    [holding('p', 'VTI', '2026-10-03', '10', '100', '1000')],
    '2026-09-01',
    [close('VTI', '2026-10-03', '110')],
  );
  assert.equal(rows.find((r) => r.asset_class === 'Unreported')!.value, 500);
  assert.equal(
    rows.reduce((s, r) => s + (r.value ?? 0), 0),
    1600,
  ); // the balance
});

test('a close that is double or half the bank price, a week old, or without a bank price is not used', () => {
  const show = (c: string, date = '2026-10-03', bankPrice: string | null = '100') =>
    buildHoldingRows(
      [account('g', 'Guard', '1000')],
      [holding('g', 'VTI', '2026-10-03', '10', bankPrice, bankPrice ? '1000' : null)],
      '2026-09-01',
      [close('VTI', date, c)],
    )[0];
  assert.equal(show('110').price, 110);
  assert.equal(show('200').price, 200); // exactly double is still used
  assert.equal(show('50').price, 50); // and exactly half
  assert.equal(show('201').price, 100); // a split the bank has not caught up with
  assert.equal(show('49').price, 100);
  assert.equal(show('110', '2026-09-26').price, 110); // seven days old: used
  assert.equal(show('110', '2026-09-25').price, 100); // eight days old: not
  assert.equal(show('110', '2026-10-03', null).price, null); // no bank price to compare with
});
