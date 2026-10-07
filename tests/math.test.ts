import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netWorth, change } from '../server/lib/math.ts';
test('assets minus debt without double-counting holdings', () =>
  assert.equal(
    netWorth([
      { kind: 'investment', balance: '100000', included: true, currency: 'USD' },
      { kind: 'cash', balance: '30000', included: true, currency: 'USD' },
      { kind: 'credit', balance: '3000', included: true, currency: 'USD' },
    ]).netWorth,
    '127000.00',
  ));
test('negative credit balances increase net worth, null remains missing', () =>
  assert.deepEqual(
    netWorth([
      { kind: 'credit', balance: '-15.25', included: true, currency: 'USD' },
      { kind: 'cash', balance: null, included: true, currency: 'USD' },
    ]),
    { assets: '0.00', liabilities: '-15.25', netWorth: '15.25', missing: 1 },
  ));
test('nonpositive baselines do not produce misleading returns', () =>
  assert.equal(change(5, 0)?.percent, null));
test('unsupported and excluded accounts are not silently added', () =>
  assert.equal(
    netWorth([
      { kind: 'cash', balance: '25', included: true, currency: 'EUR' },
      { kind: 'cash', balance: '50', included: false, currency: 'USD' },
    ]).netWorth,
    '0.00',
  ));
