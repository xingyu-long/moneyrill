// Pure logic for bank and card transactions: category mapping and turning a Plaid page into DB changes.
import Decimal from 'decimal.js';

/** Plaid's detailed personal_finance_category first, then its primary; values are categories.key. */
const DETAILED: Record<string, string> = {
  INCOME_WAGES: 'paychecks',
  INCOME_INTEREST_EARNED: 'interest',
  FOOD_AND_DRINK_GROCERIES: 'groceries',
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: 'credit_card_payment',
  RENT_AND_UTILITIES_RENT: 'rent',
  GENERAL_SERVICES_INSURANCE: 'insurance',
  GENERAL_SERVICES_AUTOMOTIVE: 'auto_maintenance',
  FOOD_AND_DRINK_COFFEE: 'coffee_shops',
  RENT_AND_UTILITIES_TELEPHONE: 'phone',
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'mortgage',
  LOAN_PAYMENTS_CAR_PAYMENT: 'auto_payment',
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: 'charity',
  TRANSPORTATION_GAS: 'gas_ev',
  TRANSPORTATION_PARKING: 'parking_tolls',
  TRANSPORTATION_TOLLS: 'parking_tolls',
  TRANSPORTATION_PUBLIC_TRANSIT: 'public_transit',
  TRANSPORTATION_TAXIS_AND_RIDE_SHARES: 'taxi',
};
const PRIMARY: Record<string, string> = {
  INCOME: 'other_income',
  TRANSFER_IN: 'transfer',
  TRANSFER_OUT: 'transfer',
  LOAN_PAYMENTS: 'credit_card_payment',
  FOOD_AND_DRINK: 'restaurants',
  GENERAL_MERCHANDISE: 'shopping',
  HOME_IMPROVEMENT: 'home_improvement',
  RENT_AND_UTILITIES: 'utilities',
  TRANSPORTATION: 'transportation',
  TRAVEL: 'travel',
  ENTERTAINMENT: 'entertainment',
  PERSONAL_CARE: 'personal_care',
  MEDICAL: 'medical',
  GOVERNMENT_AND_NON_PROFIT: 'government',
  GENERAL_SERVICES: 'services',
  BANK_FEES: 'fees',
};
// Card payments are often labelled as income or a transfer by the provider.
const CARD_PAYMENT = /\b(automatic payment|autopay|payment - thank|payment thank)/i;

export function mapProviderCategory(
  primary: string | null | undefined,
  detailed: string | null | undefined,
  name = '',
): string {
  if (CARD_PAYMENT.test(name)) return 'credit_card_payment';
  return (detailed && DETAILED[detailed]) || (primary && PRIMARY[primary]) || 'uncategorized';
}

export type PlaidTransaction = {
  transaction_id: string;
  account_id: string;
  amount: number;
  date: string;
  authorized_date?: string | null;
  name?: string | null;
  merchant_name?: string | null;
  pending: boolean;
  pending_transaction_id?: string | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null;
};
export type SyncPage = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
};
export type ProviderRow = {
  id: string;
  account_id: string;
  provider_id: string;
  date: string;
  authorized_date: string | null;
  amount: string;
  currency: string;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  pending_transaction_id: string | null;
  provider_category: string | null;
  provider_category_detailed: string | null;
  auto_category_key: string;
  provenance: string;
};
export type Changes = {
  upserts: ProviderRow[];
  /** A pending row was replaced by a posted one: copy the user's edits across. */
  carryOver: { fromId: string; toId: string }[];
  removeIds: string[];
  skipped: number;
};

/**
 * @param accounts Plaid account_id -> local account id, for the accounts we track.
 * Transactions for any other account are skipped, never an error.
 */
export function planTransactionChanges(
  connectionId: string,
  pages: SyncPage[],
  accounts: Map<string, string>,
  provenance: string,
): Changes {
  const upserts = new Map<string, ProviderRow>();
  const carry = new Map<string, string>();
  const removeIds = new Set<string>();
  let skipped = 0;
  const prefix = connectionId + ':';
  for (const page of pages) {
    for (const t of [...page.added, ...page.modified]) {
      const account = accounts.get(t.account_id);
      if (!account) {
        skipped++;
        continue;
      }
      const id = prefix + t.transaction_id;
      const name = t.name?.trim() || t.merchant_name?.trim() || 'Unnamed transaction';
      const pfc = t.personal_finance_category;
      upserts.set(id, {
        id,
        account_id: account,
        provider_id: t.transaction_id,
        date: t.date,
        authorized_date: t.authorized_date || null,
        amount: String(t.amount),
        currency: t.iso_currency_code || t.unofficial_currency_code || 'USD',
        name,
        merchant_name: t.merchant_name || null,
        pending: !!t.pending,
        pending_transaction_id: t.pending_transaction_id || null,
        provider_category: pfc?.primary || null,
        provider_category_detailed: pfc?.detailed || null,
        auto_category_key: mapProviderCategory(pfc?.primary, pfc?.detailed, name),
        provenance,
      });
      if (t.pending_transaction_id) {
        carry.set(id, prefix + t.pending_transaction_id);
        removeIds.add(prefix + t.pending_transaction_id);
      }
    }
    for (const r of page.removed) removeIds.add(prefix + r.transaction_id);
  }
  // A row that is both updated and removed in one pass ends up removed, unless it was re-added.
  for (const id of upserts.keys()) removeIds.delete(id);
  return {
    upserts: [...upserts.values()],
    carryOver: [...carry].map(([toId, fromId]) => ({ fromId, toId })),
    removeIds: [...removeIds],
    skipped,
  };
}

export type SavedRow = {
  id: string;
  account_id: string;
  date: string;
  amount: string;
  name: string;
};

/**
 * An account removed and added back in Link can be sent again under new transaction ids. In that sync only,
 * pair each new row with a saved row of the same account, date, amount and name, one to one, so the saved
 * row's edits carry over and the saved row is hidden instead of the purchase showing twice.
 * Strict on purpose: pending rows, rows already saved, rows dated on or after the account's previous sync
 * (they may be genuinely new) and any row without a one-to-one partner are left alone.
 * @param cutoffs local account id -> date of its previous sync (UTC, YYYY-MM-DD)
 */
export function matchResentTransactions(
  upserts: ProviderRow[],
  saved: SavedRow[],
  cutoffs: Map<string, string>,
  alreadyCarried: Set<string> = new Set(),
) {
  const savedIds = new Set(saved.map((r) => r.id));
  const key = (r: { account_id: string; date: string; amount: string; name: string }) =>
    [r.account_id, r.date, new Decimal(r.amount).toFixed(2), r.name].join('|');
  const free = new Map<string, SavedRow[]>();
  for (const r of [...saved].sort((a, b) => a.id.localeCompare(b.id)))
    free.set(key(r), [...(free.get(key(r)) || []), r]);
  const carryOver: { fromId: string; toId: string }[] = [];
  const removeIds: string[] = [];
  for (const u of [...upserts].sort((a, b) => a.id.localeCompare(b.id))) {
    const cutoff = cutoffs.get(u.account_id);
    if (!cutoff || u.pending || savedIds.has(u.id) || alreadyCarried.has(u.id) || u.date >= cutoff)
      continue;
    const partner = free.get(key(u))?.shift();
    if (!partner) continue;
    carryOver.push({ fromId: partner.id, toId: u.id });
    removeIds.push(partner.id);
  }
  return { carryOver, removeIds };
}

/** Plaid error codes that mean "this Item has no transactions to give us (yet)": not a failure. */
export const QUIET_TRANSACTION_ERRORS = [
  'PRODUCTS_NOT_SUPPORTED',
  'ADDITIONAL_CONSENT_REQUIRED',
  'PRODUCT_NOT_READY',
  'NO_ACCOUNTS',
];

export const MAX_SPLITS = 20;

/**
 * The parts of a split must use the parent's sign, be non-zero, and add up to the parent's amount exactly.
 * Returns an error message, or null when the split is valid.
 */
export function splitProblem(parentAmount: string | number, parts: { amount: string | number }[]) {
  if (parts.length < 2) return 'A split needs at least two parts';
  if (parts.length > MAX_SPLITS) return `A split can have at most ${MAX_SPLITS} parts`;
  const parent = new Decimal(parentAmount);
  if (parent.isZero()) return 'A transaction with no amount cannot be split';
  let total = new Decimal(0);
  for (const part of parts) {
    const amount = new Decimal(part.amount);
    if (amount.isZero()) return 'Every part needs an amount';
    if (amount.isNegative() !== parent.isNegative())
      return parent.isNegative()
        ? 'Every part must be money in, like the transaction'
        : 'Every part must be money out, like the transaction';
    total = total.plus(amount);
  }
  if (!total.equals(parent))
    return `The parts add up to ${total.toFixed(2)}, not ${parent.toFixed(2)}`;
  return null;
}

/** True when the saved parts still add up to the amount (the bank may change an amount later). */
export const splitsBalance = (
  parentAmount: string | number,
  parts: { amount: string | number }[],
) => parts.reduce((sum, p) => sum.plus(p.amount), new Decimal(0)).equals(new Decimal(parentAmount));
