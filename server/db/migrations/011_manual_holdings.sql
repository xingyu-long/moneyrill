-- Holdings the owner types in by hand for an account the provider gives no holdings for (a manual account, or a
-- brokerage whose holdings never synced). One current list per account, replaced as a whole when edited. They are
-- shown only while the provider supplies no holdings for the account, so a sync never overwrites or doubles them.
-- Additive only.
CREATE TABLE IF NOT EXISTS manual_holdings (
  id          bigserial PRIMARY KEY,
  account_id  text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  symbol      text NOT NULL DEFAULT '',
  name        text NOT NULL,
  asset_class text NOT NULL,
  quantity    numeric(24,8) NOT NULL CHECK (quantity > 0),
  price       numeric(24,8) NOT NULL CHECK (price >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manual_holdings_account ON manual_holdings(account_id);
