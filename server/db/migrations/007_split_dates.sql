-- A split part can have its own date; null means "the same date as the transaction". Additive only.
ALTER TABLE transaction_splits ADD COLUMN IF NOT EXISTS date date;
