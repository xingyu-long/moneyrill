import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balanceHistory } from '../src/lib/history.ts';
test('new accounts contribute only from their first snapshot', () => {
  const accounts = [
    { id: 'cash', kind: 'cash' },
    { id: 'card', kind: 'credit' },
    { id: 'brokerage', kind: 'investment' },
  ];
  const balances = [
    { account_id: 'cash', date: '2026-10-01', current_balance: '1500' },
    { account_id: 'card', date: '2026-10-01', current_balance: '1000' },
    { account_id: 'cash', date: '2026-10-02', current_balance: '1510' },
    { account_id: 'brokerage', date: '2026-10-03', current_balance: '200000' },
  ];
  assert.deepEqual(balanceHistory(accounts, balances, '2026-10-01', true), [
    { date: '2026-10-01', value: 500, missing: 0 },
    { date: '2026-10-02', value: 510, missing: 0 },
    { date: '2026-10-03', value: 200510, missing: 0 },
  ]);
});
test('unknown balances stay unknown, and the range carries earlier balances forward', () => {
  const accounts = [{ id: 'cash', kind: 'cash' }];
  const balances = [
    { account_id: 'cash', date: '2026-10-01', current_balance: '10' },
    { account_id: 'cash', date: '2026-10-03', current_balance: null },
  ];
  assert.deepEqual(balanceHistory(accounts, balances, '2026-10-02', true), [
    { date: '2026-10-03', value: null, missing: 1 },
  ]);
});
