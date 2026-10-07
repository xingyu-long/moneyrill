-- How much of a balance snapshot is the holdings priced at the latest market closes instead of the bank's own
-- prices: shares x (close - the bank's price), summed over the holdings with a close. The bank's own balance is
-- current_balance - holdings_adjustment. Every sync writes the bank's balance with an adjustment of 0 and the
-- price step then applies it again, so a failed price download leaves exactly the bank's balance. Additive only.
ALTER TABLE balance_snapshots ADD COLUMN IF NOT EXISTS holdings_adjustment numeric(24,8) NOT NULL DEFAULT 0;
