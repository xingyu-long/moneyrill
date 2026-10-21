// Pure logic for brokerage activity: turn Plaid's investment transactions into database rows. No I/O here.

export type PlaidSecurity = {
  security_id: string;
  ticker_symbol?: string | null;
  name?: string | null;
  is_cash_equivalent?: boolean | null;
  type?: string | null;
};
export type PlaidInvestmentTransaction = {
  investment_transaction_id: string;
  account_id: string;
  security_id?: string | null;
  date: string;
  name?: string | null;
  quantity?: number | null;
  amount: number;
  price?: number | null;
  fees?: number | null;
  type: string;
  subtype?: string | null;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  cancel_transaction_id?: string | null;
};
export type InvestmentPage = {
  transactions: PlaidInvestmentTransaction[];
  securities: PlaidSecurity[];
};
export type InvestmentRow = {
  id: string;
  account_id: string;
  provider_id: string;
  security_id: string | null;
  date: string;
  name: string;
  type: string;
  subtype: string | null;
  amount: string;
  quantity: string;
  price: string | null;
  fees: string | null;
  currency: string;
  cancel_transaction_id: string | null;
  provenance: string;
};
export type SecurityRow = {
  id: string;
  symbol: string | null;
  name: string;
  asset_class: string;
};
export type InvestmentChanges = {
  upserts: InvestmentRow[];
  securities: SecurityRow[];
  removeIds: string[];
  skipped: number;
};

/** The asset class the holdings sync has always used for a Plaid security. */
export const assetClassOf = (s: Pick<PlaidSecurity, 'is_cash_equivalent' | 'type'>) =>
  s.is_cash_equivalent
    ? 'Cash'
    : s.type === 'fixed income'
      ? 'Bonds'
      : s.type === 'equity'
        ? 'Equities'
        : s.type || 'Other';

const num = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));

/**
 * @param accounts Plaid account_id -> local account id, for the accounts we track; other rows are skipped, never an error.
 * @param window the dates asked for, and whether every page of them arrived. Saved rows (`saved`) inside a complete
 *   window that Plaid no longer returns are removed; nothing is removed from a window that was not fully read.
 */
export function planInvestmentChanges(
  connectionId: string,
  pages: InvestmentPage[],
  accounts: Map<string, string>,
  provenance: string,
  window: { from: string; to: string; complete: boolean },
  saved: { id: string; date: string }[] = [],
): InvestmentChanges {
  const prefix = connectionId + ':';
  const upserts = new Map<string, InvestmentRow>();
  const securities = new Map<string, SecurityRow>();
  let skipped = 0;
  for (const page of pages) {
    for (const s of page.securities)
      securities.set(prefix + s.security_id, {
        id: prefix + s.security_id,
        symbol: s.ticker_symbol || null,
        name: s.name || 'Unnamed security',
        asset_class: assetClassOf(s),
      });
    for (const t of page.transactions) {
      const account = accounts.get(t.account_id);
      if (!account) {
        skipped++;
        continue;
      }
      const id = prefix + t.investment_transaction_id;
      upserts.set(id, {
        id,
        account_id: account,
        provider_id: t.investment_transaction_id,
        security_id: t.security_id ? prefix + t.security_id : null,
        date: t.date,
        name: t.name?.trim() || 'Unnamed activity',
        type: t.type,
        subtype: t.subtype || null,
        amount: String(t.amount),
        quantity: String(t.quantity ?? 0),
        price: num(t.price),
        fees: num(t.fees),
        currency: t.iso_currency_code || t.unofficial_currency_code || 'USD',
        cancel_transaction_id: t.cancel_transaction_id || null,
        provenance,
      });
    }
  }
  const removeIds = window.complete
    ? saved
        .filter((r) => r.date >= window.from && r.date <= window.to && !upserts.has(r.id))
        .map((r) => r.id)
    : [];
  // Only securities a row points at are worth saving.
  const used = new Set([...upserts.values()].map((r) => r.security_id));
  return {
    upserts: [...upserts.values()],
    securities: [...securities.values()].filter((s) => used.has(s.id)),
    removeIds,
    skipped,
  };
}
