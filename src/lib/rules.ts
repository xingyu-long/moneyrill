// Pure helpers for the rules screens: the form's draft, the request it becomes, and the sentence for a rule.

export type TextOp = 'contains' | 'equals' | 'starts_with';
export type AmountOp = 'gt' | 'lt' | 'eq' | 'between';
export type RuleConditions = {
  merchant?: { op: TextOp; values: string[] };
  statement?: { op: TextOp; values: string[] };
  amount?: { direction: 'debit' | 'credit'; op: AmountOp; value: string; value2?: string };
  categories?: number[];
  accounts?: string[];
};
export type Rule = {
  id: number;
  conditions: RuleConditions;
  category_id: number;
  category: { id: number; name: string; emoji: string | null };
  last_applied_at: string | null;
  last_applied_count: number | null;
};
export type RulePreview = {
  matching: number;
  skipped: { edited: number; split: number };
  total: number;
  changes: {
    id: string;
    date: string;
    merchant: string;
    account: string;
    amount: string;
    from: { name: string; emoji: string | null };
    to: { name: string; emoji: string | null };
  }[];
};

export const TEXT_OPS: { op: TextOp; label: string }[] = [
  { op: 'contains', label: 'Contains' },
  { op: 'equals', label: 'Exactly matches' },
  { op: 'starts_with', label: 'Starts with' },
];
export const AMOUNT_OPS: { op: AmountOp; label: string }[] = [
  { op: 'gt', label: 'Greater than' },
  { op: 'lt', label: 'Less than' },
  { op: 'eq', label: 'Equals' },
  { op: 'between', label: 'Between' },
];

/** The editor's state: one block per condition, each with an on/off switch. */
export type Draft = {
  merchantOn: boolean;
  merchantOp: TextOp;
  merchantValues: string[];
  statementOn: boolean;
  statementOp: TextOp;
  statementValues: string[];
  amountOn: boolean;
  direction: 'debit' | 'credit';
  amountOp: AmountOp;
  amount: string;
  amount2: string;
  categoriesOn: boolean;
  categories: number[];
  accountsOn: boolean;
  accounts: string[];
  categoryId: number | null;
};

export const emptyDraft = (): Draft => ({
  merchantOn: true,
  merchantOp: 'contains',
  merchantValues: [''],
  statementOn: false,
  statementOp: 'contains',
  statementValues: [''],
  amountOn: false,
  direction: 'debit',
  amountOp: 'gt',
  amount: '',
  amount2: '',
  categoriesOn: false,
  categories: [],
  accountsOn: false,
  accounts: [],
  categoryId: null,
});

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const clean = (values: string[]) => values.map((v) => v.trim()).filter(Boolean);

export function draftOf(rule: Rule): Draft {
  const c = rule.conditions;
  const d = emptyDraft();
  return {
    ...d,
    merchantOn: !!c.merchant,
    merchantOp: c.merchant?.op ?? d.merchantOp,
    merchantValues: c.merchant?.values ?? d.merchantValues,
    statementOn: !!c.statement,
    statementOp: c.statement?.op ?? d.statementOp,
    statementValues: c.statement?.values ?? d.statementValues,
    amountOn: !!c.amount,
    direction: c.amount?.direction ?? d.direction,
    amountOp: c.amount?.op ?? d.amountOp,
    amount: c.amount?.value ?? '',
    amount2: c.amount?.value2 ?? '',
    categoriesOn: !!c.categories,
    categories: c.categories ?? [],
    accountsOn: !!c.accounts,
    accounts: c.accounts ?? [],
    categoryId: rule.category_id,
  };
}

/** The request body for a draft, or the reason it is not ready (shown next to Save). */
export function bodyOf(
  d: Draft,
): { body: { conditions: RuleConditions; category_id: number } } | { problem: string } {
  const conditions: RuleConditions = {};
  if (d.merchantOn) {
    const values = clean(d.merchantValues);
    if (!values.length) return { problem: 'Enter the merchant text to look for' };
    conditions.merchant = { op: d.merchantOp, values };
  }
  if (d.statementOn) {
    const values = clean(d.statementValues);
    if (!values.length) return { problem: 'Enter the statement text to look for' };
    conditions.statement = { op: d.statementOp, values };
  }
  if (d.amountOn) {
    const value = d.amount.trim().replace(/^\$/, '');
    const value2 = d.amount2.trim().replace(/^\$/, '');
    if (!MONEY.test(value) || (d.amountOp === 'between' && !MONEY.test(value2)))
      return { problem: 'Enter the amount as dollars and cents' };
    conditions.amount = {
      direction: d.direction,
      op: d.amountOp,
      value,
      ...(d.amountOp === 'between' ? { value2 } : {}),
    };
  }
  if (d.categoriesOn) {
    if (!d.categories.length) return { problem: 'Choose at least one category to match' };
    conditions.categories = d.categories;
  }
  if (d.accountsOn) {
    if (!d.accounts.length) return { problem: 'Choose at least one account to match' };
    conditions.accounts = d.accounts;
  }
  if (!Object.keys(conditions).length) return { problem: 'Turn on at least one condition' };
  if (d.categoryId === null) return { problem: 'Choose the category to apply' };
  return { body: { conditions, category_id: d.categoryId } };
}

const OP_WORDS: Record<TextOp, string> = {
  contains: 'contains',
  equals: 'exactly matches',
  starts_with: 'starts with',
};
const AMOUNT_WORDS: Record<AmountOp, string> = {
  gt: 'greater than',
  lt: 'less than',
  eq: 'equals',
  between: 'between',
};
const dollars = (v: string) => '$' + Number(v).toFixed(2);

/** One line per condition: "merchant name contains vmware or amazon". */
export function describeConditions(
  c: RuleConditions,
  names: { category: (id: number) => string; account: (id: string) => string },
): string[] {
  const lines: string[] = [];
  if (c.merchant)
    lines.push(`merchant name ${OP_WORDS[c.merchant.op]} ${c.merchant.values.join(' or ')}`);
  if (c.statement)
    lines.push(`original statement ${OP_WORDS[c.statement.op]} ${c.statement.values.join(' or ')}`);
  if (c.amount) {
    const a = c.amount;
    lines.push(
      `${a.direction} ${AMOUNT_WORDS[a.op]} ${dollars(a.value)}${a.op === 'between' ? ` and ${dollars(a.value2 ?? a.value)}` : ''}`,
    );
  }
  if (c.categories) lines.push(`category is ${c.categories.map(names.category).join(' or ')}`);
  if (c.accounts) lines.push(`account is ${c.accounts.map(names.account).join(' or ')}`);
  return lines;
}

/** The ids with `from` moved to `to` (dragging a rule, or the up and down buttons). */
export function moved<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const out = items.slice();
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
}
