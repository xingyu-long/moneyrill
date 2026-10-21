export type Account = {
  id: string;
  name: string;
  institution: string;
  kind: string;
  currency: string;
  mask: string;
  included: boolean;
  source: string;
  balance: string | null;
  /** Part of the balance that is holdings valued at the latest market closes instead of the bank's prices. */
  balance_adjustment?: string | null;
  balance_date: string;
  last_synced: string;
  last_error: string | null;
  provider_as_of: string | null;
  holdings_as_of: string | null;
};

export type Balance = {
  account_id: string;
  date: string;
  current_balance: string | null;
  provenance: string;
};

export type Holding = {
  account_id: string;
  security_id: string;
  date: string;
  quantity: string | null;
  price: string | null;
  value: string | null;
  cost_basis: string | null;
  symbol: string;
  name: string;
  asset_class: string;
  provenance: string;
};

/** The closing price of a ticker on a day (a decimal string, as the database sends it). */
export type Price = { symbol: string; date: string; close: string };

export type Benchmark = { symbol: string; date: string; level: string; provenance: string };

export type Data = {
  accounts: Account[];
  balances: Balance[];
  holdings: Holding[];
  /** Daily closes of the tickers held in real accounts; these win over the price the bank sent. */
  prices?: Price[];
  benchmarks: Benchmark[];
  connections: any[];
  runs: any[];
  /** Merged imported + live daily totals; empty unless totals were imported. */
  netWorth?: { date: string; net_worth: string }[];
  hasSandboxKeys: boolean;
  hasPlaidKeys: boolean;
  mode: string;
};

/** One holding in one account, with numbers parsed. */
export type HoldingRow = Omit<
  Holding,
  'quantity' | 'price' | 'value' | 'cost_basis' | 'provenance'
> & {
  provenance?: string;
  quantity: number | null;
  price: number | null;
  value: number | null;
  cost_basis: number | null;
  change: number | null;
  accountName: string | null;
  /** The day of the closing price shown, when it came from the market data instead of the bank. */
  priceDate?: string;
};

/** The same security summed across the selected accounts. */
export type Position = HoldingRow & { costKnown: boolean };

export type SortState = { key: string; dir: 'asc' | 'desc' };

export type CategoryType = 'income' | 'expense' | 'transfer';

export type CategoryGroup = { id: number; type: CategoryType; name: string; sort_order: number };

export type Category = {
  id: number;
  name: string;
  emoji: string;
  group_id: number;
  group_name: string;
  type: CategoryType;
  key: string | null;
  sort_order: number;
  transaction_count: number;
};

export type Split = {
  id: number;
  /** Provider sign, like the transaction: positive = money out. */
  amount: string;
  notes: string;
  /** This part's own date; null means the same date as the transaction. */
  date: string | null;
  category: { id: number; name: string; emoji: string; group: string };
};

export type Transaction = {
  id: string;
  account_id: string;
  account_name: string;
  account_mask: string | null;
  institution: string;
  account_included: boolean;
  /** The date shown: your date if you changed it, otherwise the bank's. */
  date: string;
  provider_date: string;
  user_date: string | null;
  /** Provider sign: positive = money out. */
  amount: string;
  currency: string;
  name: string;
  merchant_name: string | null;
  pending: boolean;
  notes: string;
  category: { id: number; name: string; emoji: string; group: string } | null;
  category_source: 'user' | 'rule' | 'auto' | 'none';
  rule_id: number | null;
  /** Where it came from: the bank, a Monarch import, or you. */
  source: 'plaid' | 'monarch' | 'manual';
  /** Empty when the transaction is not split. */
  splits: Split[];
  /** False when the bank changed the amount after the split was saved. */
  split_balanced: boolean;
};

// --- Reports ---
export type ReportCategory = { id: number; name: string; emoji: string; group: string };
export type ReportSlice = { category: ReportCategory; amount: string; share: number };
export type ReportTotals = {
  income: string;
  expenses: string;
  net: string;
  /** Percent of income kept; null when there was no income. */
  savings_rate: number | null;
};
export type ReportPeriod = {
  start: string;
  end: string;
  income: string;
  expenses: string;
  net: string;
  /** The range ends (or starts) inside this period, so its figures are not final. */
  partial: boolean;
};
export type CashFlowReport = {
  range: { from: string | null; to: string | null };
  totals: ReportTotals;
  series: ReportPeriod[];
  breakdown: {
    from: string | null;
    to: string | null;
    totals: ReportTotals;
    income: ReportSlice[];
    expenses: ReportSlice[];
  };
  first_date: string | null;
  last_date: string | null;
  skipped_non_usd: number;
};
export type CategoryReport = {
  type: 'income' | 'expense';
  total: string;
  slices: ReportSlice[];
  summary: {
    count: number;
    largest: string;
    average: string;
    first_date: string | null;
    last_date: string | null;
  };
};
