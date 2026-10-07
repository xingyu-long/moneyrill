CREATE TABLE IF NOT EXISTS connections (
 id text PRIMARY KEY, institution text NOT NULL, token text NOT NULL, products jsonb NOT NULL,
 environment text NOT NULL CHECK (environment='sandbox'), created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS accounts (
 id text PRIMARY KEY, connection_id text REFERENCES connections(id), provider_id text, name text NOT NULL,
 institution text NOT NULL, kind text NOT NULL CHECK(kind IN ('investment','cash','credit','loan')),
 currency text NOT NULL DEFAULT 'USD', mask text, included boolean NOT NULL DEFAULT true,
 source text NOT NULL, last_synced timestamptz, last_error text,
 UNIQUE(connection_id,provider_id)
);
CREATE TABLE IF NOT EXISTS balance_snapshots (
 id bigserial PRIMARY KEY, account_id text REFERENCES accounts(id) ON DELETE CASCADE,
 date date NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(), current_balance numeric(24,8),
 provenance text NOT NULL, UNIQUE(account_id,date)
);
CREATE TABLE IF NOT EXISTS securities (
 id text PRIMARY KEY, symbol text, name text NOT NULL, asset_class text NOT NULL
);
CREATE TABLE IF NOT EXISTS holding_snapshots (
 account_id text REFERENCES accounts(id) ON DELETE CASCADE, security_id text REFERENCES securities(id),
 date date NOT NULL, quantity numeric(28,12), price numeric(24,8), value numeric(24,8), cost_basis numeric(24,8),
 provenance text NOT NULL, PRIMARY KEY(account_id,security_id,date)
);
CREATE TABLE IF NOT EXISTS benchmark_observations (
 symbol text, date date, level numeric(24,10) NOT NULL, provenance text NOT NULL,
 PRIMARY KEY(symbol,date)
);
CREATE TABLE IF NOT EXISTS daily_net_worth (
 date date PRIMARY KEY, assets numeric(24,8), liabilities numeric(24,8), net_worth numeric(24,8),
 missing_accounts integer NOT NULL, computed_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_runs (
 id bigserial PRIMARY KEY, started_at timestamptz DEFAULT now(), finished_at timestamptz,
 status text NOT NULL, message text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS balances_account_date ON balance_snapshots(account_id,date DESC);
CREATE INDEX IF NOT EXISTS holdings_account_date ON holding_snapshots(account_id,date DESC);
-- Preserve every observation; the daily table above is the chart projection.
CREATE TABLE IF NOT EXISTS balance_observations (
 id bigserial PRIMARY KEY, account_id text REFERENCES accounts(id) ON DELETE CASCADE,
 date date NOT NULL, observed_at timestamptz NOT NULL,
 current_balance numeric(24,8), provenance text NOT NULL
);
CREATE OR REPLACE FUNCTION record_balance_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO balance_observations(account_id,date,observed_at,current_balance,provenance)
 VALUES(NEW.account_id,NEW.date,NEW.observed_at,NEW.current_balance,NEW.provenance);
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS balance_observed ON balance_snapshots;
CREATE TRIGGER balance_observed AFTER INSERT OR UPDATE ON balance_snapshots
FOR EACH ROW EXECUTE FUNCTION record_balance_observation();

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS provider_as_of timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS holdings_as_of date;

-- Additive upgrade; no financial records are removed by deployment.
ALTER TABLE connections DROP CONSTRAINT IF EXISTS connections_environment_check;
ALTER TABLE connections ADD CONSTRAINT connections_environment_check CHECK(environment IN ('sandbox','production'));
ALTER TABLE connections ADD COLUMN IF NOT EXISTS disconnected_at timestamptz;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS last_synced timestamptz;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS consent_expires_at timestamptz;
