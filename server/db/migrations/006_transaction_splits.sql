-- A transaction can be split into parts, each with its own amount, category and notes.
-- The parts use the parent's sign and add up to the parent's amount (checked by the API). Additive only.
CREATE TABLE IF NOT EXISTS transaction_splits (
  id              bigserial PRIMARY KEY,
  transaction_id  text NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount          numeric(24,8) NOT NULL,
  category_id     bigint REFERENCES categories(id) ON DELETE SET NULL,  -- null shows as Uncategorized
  notes           text NOT NULL DEFAULT '',
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transaction_splits_transaction ON transaction_splits(transaction_id);
