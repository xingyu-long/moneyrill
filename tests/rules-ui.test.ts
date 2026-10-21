import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyOf,
  describeConditions,
  draftOf,
  emptyDraft,
  matchSummary,
  moved,
  ruleAccounts,
  type Rule,
} from '../src/lib/rules.ts';

test('a draft becomes a request, or says what is missing', () => {
  const d = emptyDraft();
  assert.deepEqual(bodyOf(d), { problem: 'Enter the merchant text to look for' });
  d.merchantValues = [' vmware ', ''];
  assert.deepEqual(bodyOf(d), { problem: 'Choose the category to apply' });
  d.categoryId = 7;
  assert.deepEqual(bodyOf(d), {
    body: { conditions: { merchant: { op: 'contains', values: ['vmware'] } }, category_id: 7 },
  });
  d.amountOn = true;
  d.amount = '$5';
  assert.ok('body' in bodyOf(d));
  d.amountOp = 'between';
  assert.deepEqual(bodyOf(d), { problem: 'Enter the amount as dollars and cents' });
  d.amount2 = '9.50';
  assert.deepEqual((bodyOf(d) as any).body.conditions.amount, {
    direction: 'debit',
    op: 'between',
    value: '5',
    value2: '9.50',
  });
  d.amountOn = false;
  d.merchantOn = false;
  assert.deepEqual(bodyOf(d), { problem: 'Turn on at least one condition' });
});

test('a saved rule opens as the same draft it was made from', () => {
  const rule: Rule = {
    id: 1,
    conditions: {
      merchant: { op: 'equals', values: ['costco'] },
      categories: [3],
      amount: { direction: 'credit', op: 'lt', value: '20' },
    },
    category_id: 9,
    category: { id: 9, name: 'Groceries', emoji: null },
    last_applied_at: null,
    last_applied_count: null,
  };
  assert.deepEqual((bodyOf(draftOf(rule)) as any).body, {
    conditions: rule.conditions,
    category_id: 9,
  });
  assert.deepEqual(
    describeConditions(rule.conditions, { category: (id) => 'Shopping' + id, account: (id) => id }),
    ['merchant name exactly matches costco', 'credit less than $20.00', 'category is Shopping3'],
  );
});

test('moving a rule changes its place and nothing else', () => {
  assert.deepEqual(moved([1, 2, 3, 4], 3, 0), [4, 1, 2, 3]);
  assert.deepEqual(moved([1, 2, 3, 4], 0, 1), [2, 1, 3, 4]);
  const same = [1, 2];
  assert.equal(moved(same, 0, 5), same);
});

test('the footer says why matches are skipped, so a zero is never a mystery', () => {
  const s = (matching: number, edited = 0, split = 0, manual = 0) =>
    matchSummary({ matching, skipped: { edited, split, manual } });
  assert.equal(s(1), '1 matching transaction');
  assert.equal(s(3), '3 matching transactions');
  assert.equal(s(0, 0, 0, 1), '0 matching transactions · 1 skipped because you added it');
  assert.equal(s(0, 0, 0, 2), '0 matching transactions · 2 skipped because you added them');
  assert.equal(s(2, 1), '2 matching transactions · 1 skipped because you categorised it yourself');
  assert.equal(s(0, 0, 3), '0 matching transactions · 3 skipped because they are split');
  assert.equal(
    s(0, 40, 1, 2),
    '0 matching transactions · 43 skipped (40 you categorised, 1 split, 2 you added)',
  );
});

test('a rule can be limited to any account a transaction can be on, brokerages included', () => {
  const a = (id: string, kind: string, source = 'plaid') => ({ id, kind, source });
  const ids = ruleAccounts([
    a('checking', 'cash'),
    a('card', 'credit'),
    a('pcra', 'investment'),
    a('401k', 'investment', 'manual'),
    a('mortgage', 'loan'),
    a('private-loan', 'loan', 'manual'),
  ]).map((x) => x.id);
  assert.deepEqual(ids, ['checking', 'card', 'pcra', '401k', 'private-loan']);
});
