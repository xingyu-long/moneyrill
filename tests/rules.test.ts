import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesConditions, resolveRules, type RuleDef } from '../server/lib/rules.ts';
import { previewRuleBody, saveRuleBody } from '../server/lib/schemas.ts';

const row = (o: Partial<Parameters<typeof matchesConditions>[1]> = {}) => ({
  merchant: 'VMware Inc',
  statement: 'VMWARE PAYROLL 1234',
  amount: '-2500.00',
  account_id: 'a1',
  ...o,
});
const rule = (id: number, conditions: RuleDef['conditions'], category_id: number): RuleDef => ({
  id,
  conditions,
  category_id,
});

test('text matches ignore case and any one value is enough', () => {
  const m = (op: any, values: string[]) =>
    matchesConditions({ merchant: { op, values } }, row(), 1);
  assert.ok(m('contains', ['vmware']));
  assert.ok(m('contains', ['nope', 'WARE']));
  assert.ok(!m('equals', ['vmware']));
  assert.ok(m('equals', [' vmware inc ']));
  assert.ok(m('starts_with', ['vm']));
  assert.ok(!m('starts_with', ['ware']));
  assert.ok(!m('contains', ['']));
});

test('the statement and the merchant are separate fields', () => {
  assert.ok(matchesConditions({ statement: { op: 'contains', values: ['payroll'] } }, row(), 1));
  assert.ok(!matchesConditions({ merchant: { op: 'contains', values: ['payroll'] } }, row(), 1));
});

test('amount: direction and size, with the bank sign', () => {
  const debit = (op: any, value: string, value2?: string) => ({
    amount: { direction: 'debit' as const, op, value, value2 },
  });
  const credit = { amount: { direction: 'credit' as const, op: 'gt' as const, value: '0' } };
  assert.ok(matchesConditions(credit, row(), 1));
  assert.ok(!matchesConditions(debit('gt', '0'), row(), 1));
  const spend = row({ amount: '12.50' });
  assert.ok(matchesConditions(debit('gt', '12.49'), spend, 1));
  assert.ok(!matchesConditions(debit('gt', '12.50'), spend, 1));
  assert.ok(matchesConditions(debit('lt', '13'), spend, 1));
  assert.ok(matchesConditions(debit('eq', '12.5'), spend, 1));
  assert.ok(matchesConditions(debit('between', '20', '10'), spend, 1));
  assert.ok(!matchesConditions(credit, spend, 1));
  // money exactly zero is neither
  assert.ok(!matchesConditions(debit('gt', '-1'), row({ amount: '0' }), 1));
});

test('every condition must hold, and a rule with none matches nothing', () => {
  const c = { merchant: { op: 'contains' as const, values: ['vmware'] }, accounts: ['a2'] };
  assert.ok(!matchesConditions(c, row(), 1));
  assert.ok(matchesConditions({ ...c, accounts: ['a1', 'a2'] }, row(), 1));
  assert.ok(!matchesConditions({}, row(), 1));
});

test('rules run in order, each sees the category the one above left, and the last match wins', () => {
  const rules = [
    rule(1, { merchant: { op: 'contains', values: ['vmware'] } }, 10),
    rule(2, { merchant: { op: 'contains', values: ['vmware'] } }, 20),
    rule(3, { categories: [10] }, 30),
    rule(4, { categories: [99] }, 40),
  ];
  // rule 3 only matches because rule 1 ran first, but rule 2 then replaced 10 with 20: so 3 does not match
  assert.deepEqual(resolveRules(rules, row(), 5), { rule_id: 2, category_id: 20 });
  assert.deepEqual(resolveRules([rules[0], rules[2]], row(), 5), { rule_id: 3, category_id: 30 });
  assert.equal(resolveRules(rules, row({ merchant: 'Other', statement: 'x' }), 5), null);
  // the starting category counts for the first rules too
  assert.deepEqual(resolveRules([rules[3]], row(), 99), { rule_id: 4, category_id: 40 });
});

test('the request bodies reject empty and malformed rules', () => {
  const ok = { conditions: { merchant: { op: 'contains', values: ['x'] } }, category_id: 1 };
  assert.ok(saveRuleBody.safeParse(ok).success);
  assert.equal(saveRuleBody.parse(ok).apply, false);
  assert.ok(previewRuleBody.safeParse({ ...ok, rule_id: 3 }).success);
  const bad = (conditions: unknown) =>
    !saveRuleBody.safeParse({ conditions, category_id: 1 }).success;
  assert.ok(bad({}));
  assert.ok(bad({ merchant: { op: 'contains', values: [] } }));
  assert.ok(bad({ merchant: { op: 'regex', values: ['x'] } }));
  assert.ok(bad({ amount: { direction: 'debit', op: 'between', value: '1' } }));
  assert.ok(bad({ amount: { direction: 'debit', op: 'gt', value: '1', value2: '2' } }));
  assert.ok(bad({ amount: { direction: 'debit', op: 'gt', value: '1.234' } }));
  assert.ok(bad({ nonsense: true }));
});
