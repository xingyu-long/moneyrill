import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyOf,
  describeConditions,
  draftOf,
  emptyDraft,
  moved,
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
