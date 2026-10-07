-- Net worth totals imported from another tracker (e.g. Monarch), covering accounts this app cannot see.
-- recompute() uses them for days before every account has live data, then switches to the live totals.
CREATE TABLE IF NOT EXISTS imported_net_worth (
  date date PRIMARY KEY,
  assets numeric(24,8) NOT NULL,
  liabilities numeric(24,8) NOT NULL,
  net_worth numeric(24,8) NOT NULL,
  source text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
