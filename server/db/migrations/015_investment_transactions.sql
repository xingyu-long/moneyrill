-- Activity in brokerage accounts (Plaid /investments/transactions/get): buys, sells, dividends, fees, deposits and
-- share transfers. Kept apart from `transactions`: the shape differs (a security, quantity, price, fees, no merchant,
-- no automatic category) and no money query may count it by accident. It counts in Reports only once the owner gives
-- a row a category (category_id). Additive only.
CREATE TABLE IF NOT EXISTS investment_transactions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  security_id text REFERENCES securities(id) ON DELETE SET NULL,
  date date NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  subtype text,
  amount numeric(24,8) NOT NULL,
  quantity numeric(28,12) NOT NULL DEFAULT 0,
  price numeric(24,8),
  fees numeric(24,8),
  currency text NOT NULL DEFAULT 'USD',
  cancel_transaction_id text,
  category_id bigint REFERENCES categories(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  provenance text NOT NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS investment_transactions_date_idx ON investment_transactions(date DESC, id DESC);
CREATE INDEX IF NOT EXISTS investment_transactions_account_idx ON investment_transactions(account_id);
ALTER TABLE connections ADD COLUMN IF NOT EXISTS investments_backfilled_at timestamptz;
