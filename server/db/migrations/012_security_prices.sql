-- Daily closing price per ticker, downloaded on every sync for the securities held in the real (not demo)
-- accounts, so every account values the same ticker at the same price. A symbol's rows from the start of the
-- window are replaced on each download (closes are revised after a split); a failed download keeps what is
-- stored. Additive only.
CREATE TABLE IF NOT EXISTS security_prices (
  symbol text NOT NULL,
  date   date NOT NULL,
  close  numeric(24,8) NOT NULL CHECK (close > 0),
  PRIMARY KEY (symbol, date)
);
