// Pure logic for rules: does a transaction match, and which rule wins. No database here.
import Decimal from 'decimal.js';

export type TextMatch = { op: 'contains' | 'equals' | 'starts_with'; values: string[] };
export type AmountMatch = {
  direction: 'debit' | 'credit';
  op: 'gt' | 'lt' | 'eq' | 'between';
  value: string;
  value2?: string;
};
export type Conditions = {
  merchant?: TextMatch;
  statement?: TextMatch;
  amount?: AmountMatch;
  categories?: number[];
  accounts?: string[];
};
export type RuleDef = { id: number | null; conditions: Conditions; category_id: number };
/** What a rule looks at. `amount` has Plaid's sign: positive is money out. */
export type RuleInput = { merchant: string; statement: string; amount: string; account_id: string };

const lower = (s: string) => s.trim().toLowerCase();

function textMatches(m: TextMatch, text: string) {
  const t = lower(text);
  return m.values.some((v) => {
    const w = lower(v);
    if (!w) return false;
    if (m.op === 'equals') return t === w;
    if (m.op === 'starts_with') return t.startsWith(w);
    return t.includes(w);
  });
}

function amountMatches(m: AmountMatch, amount: string) {
  const a = new Decimal(amount);
  if (m.direction === 'debit' ? a.lte(0) : a.gte(0)) return false;
  const size = a.abs();
  const v = new Decimal(m.value);
  if (m.op === 'gt') return size.gt(v);
  if (m.op === 'lt') return size.lt(v);
  if (m.op === 'eq') return size.eq(v);
  return (
    size.gte(Decimal.min(v, m.value2 ?? m.value)) && size.lte(Decimal.max(v, m.value2 ?? m.value))
  );
}

/** Every condition the rule has must hold; a rule with no conditions matches nothing. `category` is the current one. */
export function matchesConditions(c: Conditions, row: RuleInput, category: number) {
  let any = false;
  if (c.merchant) {
    any = true;
    if (!textMatches(c.merchant, row.merchant)) return false;
  }
  if (c.statement) {
    any = true;
    if (!textMatches(c.statement, row.statement)) return false;
  }
  if (c.amount) {
    any = true;
    if (!amountMatches(c.amount, row.amount)) return false;
  }
  if (c.categories) {
    any = true;
    if (!c.categories.includes(category)) return false;
  }
  if (c.accounts) {
    any = true;
    if (!c.accounts.includes(row.account_id)) return false;
  }
  return any;
}

/**
 * Run the rules top to bottom: each one sees the category the ones above it left, and a later match wins.
 * `base` is the category without any rule (the automatic one). Returns the winning rule, or null.
 */
export function resolveRules(rules: RuleDef[], row: RuleInput, base: number) {
  let category = base;
  let winner: RuleDef | null = null;
  for (const r of rules)
    if (matchesConditions(r.conditions, row, category)) {
      category = r.category_id;
      winner = r;
    }
  return winner ? { rule_id: winner.id, category_id: category } : null;
}
