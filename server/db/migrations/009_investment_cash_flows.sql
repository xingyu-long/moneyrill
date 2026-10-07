-- Money that entered (positive) or left (negative) the investment accounts from outside, one row per month.
-- The portfolio return is only calculated for months that have a row, so a row is also the statement "the cash
-- flows of this month are known". A month-end job fills in the month that just closed, from the transactions on
-- the investment accounts and the bank transfers to and from brokerages; it never overwrites a row, so a row you
-- add or correct by hand (or backfill from your own records) stays as you set it. Additive only.
CREATE TABLE IF NOT EXISTS investment_cash_flows (
  month           date PRIMARY KEY CHECK (extract(day FROM month) = 1),
  amount          numeric(24,8) NOT NULL,
  -- Sum of each flow times the share of the month it was in the account. Null = assume the middle of the month.
  weighted_amount numeric(24,8),
  source          text NOT NULL DEFAULT 'computed',   -- computed | manual | demo
  note            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
