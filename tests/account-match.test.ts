import test from 'node:test';
import assert from 'node:assert/strict';
import { matchReturnedAccounts } from '../server/lib/account-match.ts';

const saved = (id: string, name: string, mask: string | null, kind = 'investment') => ({
  id: 'c:' + id,
  provider_id: id,
  name,
  mask,
  kind,
  currency: 'USD',
});
const back = (id: string, name: string, mask: string | null, kind = 'investment') => ({
  account_id: id,
  name,
  mask,
  kind,
  currency: 'USD',
});

test('an account added back with a new id is matched to the saved one', () => {
  const m = matchReturnedAccounts(
    [saved('old', 'Plaid IRA', '5555'), saved('hsa', 'Plaid HSA', '9001')],
    [back('new', 'Plaid IRA', '5555'), back('hsa', 'Plaid HSA', '9001')],
  );
  assert.deepEqual([...m], [['new', 'c:old']]);
});

test('accounts Plaid still returns under the same id are not touched', () => {
  const m = matchReturnedAccounts([saved('a', 'IRA', '5555')], [back('a', 'IRA', '5555')]);
  assert.equal(m.size, 0);
});

test('a different account is never merged: name, digits, type or currency must all agree', () => {
  const known = [saved('old', 'Plaid IRA', '5555')];
  for (const other of [
    back('x', 'Plaid Roth', '5555'),
    back('x', 'Plaid IRA', '6666'),
    back('x', 'Plaid IRA', '5555', 'cash'),
    { ...back('x', 'Plaid IRA', '5555'), currency: 'EUR' },
  ])
    assert.equal(matchReturnedAccounts(known, [other]).size, 0);
});

test('the name is compared without case or surrounding spaces', () => {
  const m = matchReturnedAccounts(
    [saved('old', 'Plaid IRA', '5555')],
    [back('n', ' plaid ira ', '5555')],
  );
  assert.equal(m.get('n'), 'c:old');
});

test('without last digits nothing is matched', () => {
  assert.equal(
    matchReturnedAccounts([saved('old', 'IRA', null)], [back('n', 'IRA', null)]).size,
    0,
  );
  assert.equal(matchReturnedAccounts([saved('old', 'IRA', '')], [back('n', 'IRA', '')]).size, 0);
});

test('two saved accounts that fit leave the new one unmatched', () => {
  const m = matchReturnedAccounts(
    [saved('o1', 'Savings', '1111', 'cash'), saved('o2', 'Savings', '1111', 'cash')],
    [back('n', 'Savings', '1111', 'cash')],
  );
  assert.equal(m.size, 0);
});

test('two new accounts that fit one saved account leave both unmatched', () => {
  const m = matchReturnedAccounts(
    [saved('o', 'Savings', '1111', 'cash')],
    [back('n1', 'Savings', '1111', 'cash'), back('n2', 'Savings', '1111', 'cash')],
  );
  assert.equal(m.size, 0);
});

test('a saved account that is still returned is not a candidate', () => {
  const m = matchReturnedAccounts(
    [saved('keep', 'IRA', '5555')],
    [back('keep', 'IRA', '5555'), back('n', 'IRA', '5555')],
  );
  assert.equal(m.size, 0);
});

test('several accounts can be matched at once', () => {
  const m = matchReturnedAccounts(
    [saved('o1', 'IRA', '5555'), saved('o2', 'HSA', '9001')],
    [back('n1', 'IRA', '5555'), back('n2', 'HSA', '9001')],
  );
  assert.deepEqual([...m].sort(), [
    ['n1', 'c:o1'],
    ['n2', 'c:o2'],
  ]);
});
