-- Bank and card transactions (Plaid /transactions/sync), plus the user's own categories.
-- Additive only. Provider columns are overwritten by every sync; user columns
-- (user_date, category_id, notes) are never touched by it.
ALTER TABLE connections ADD COLUMN IF NOT EXISTS transactions_cursor text;

CREATE TABLE IF NOT EXISTS categories (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  group_name  text NOT NULL DEFAULT 'Other',
  emoji       text NOT NULL DEFAULT '',
  key         text UNIQUE,            -- stable slug for seeded defaults; null for user-created ones
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name ON categories(lower(name));

CREATE TABLE IF NOT EXISTS transactions (
  id                         text PRIMARY KEY,   -- connection id || ':' || Plaid transaction_id
  account_id                 text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider_id                text,               -- Plaid transaction_id (null for imported rows)
  source                     text NOT NULL DEFAULT 'plaid',
  external_id                text,               -- id in the source system, for re-import dedupe
  date                       date NOT NULL,      -- posted date from the provider
  authorized_date            date,
  amount                     numeric(24,8) NOT NULL,   -- provider sign: positive = money out
  currency                   text NOT NULL DEFAULT 'USD',
  name                       text NOT NULL,      -- the original statement text
  merchant_name              text,
  pending                    boolean NOT NULL DEFAULT false,
  pending_transaction_id     text,
  provider_category          text,
  provider_category_detailed text,
  auto_category_key          text,               -- categories.key derived from the provider category
  provenance                 text NOT NULL,
  removed_at                 timestamptz,        -- Plaid removed it: hidden, but the user's edits are kept
  user_date                  date,               -- null = use the provider date
  category_id                bigint REFERENCES categories(id) ON DELETE SET NULL,  -- null = automatic
  notes                      text NOT NULL DEFAULT '',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_effective_date
  ON transactions((coalesce(user_date, date)) DESC, id DESC) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS transactions_account ON transactions(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_external
  ON transactions(source, external_id) WHERE external_id IS NOT NULL;

INSERT INTO categories(key, name, group_name, emoji, sort_order) VALUES
  ('paychecks',          'Paychecks',            'Income',             '💵', 10),
  ('interest',           'Interest',             'Income',             '🪙', 11),
  ('other_income',       'Other Income',         'Income',             '💰', 12),
  ('transfer',           'Transfer',             'Transfers',          '🔁', 20),
  ('credit_card_payment','Credit Card Payment',  'Transfers',          '💳', 21),
  ('groceries',          'Groceries',            'Food & Dining',      '🥑', 30),
  ('restaurants',        'Restaurants & Bars',   'Food & Dining',      '🍽️', 31),
  ('shopping',           'Shopping',             'Shopping',           '🛍️', 40),
  ('rent',               'Rent',                 'Housing',            '🏠', 50),
  ('home_improvement',   'Home Improvement',     'Housing',            '🔨', 51),
  ('utilities',          'Utilities',            'Bills & Utilities',  '💡', 60),
  ('insurance',          'Insurance',            'Bills & Utilities',  '☂️', 61),
  ('transportation',     'Transportation',       'Auto & Transport',   '🚗', 70),
  ('travel',             'Travel',               'Travel & Lifestyle', '✈️', 80),
  ('entertainment',      'Entertainment',        'Travel & Lifestyle', '🎬', 81),
  ('personal_care',      'Personal Care',        'Travel & Lifestyle', '💇', 82),
  ('medical',            'Medical',              'Health',             '🩺', 90),
  ('government',         'Taxes & Government',   'Other',              '🏛️', 100),
  ('services',           'Services',             'Other',              '🧾', 101),
  ('fees',               'Fees',                 'Other',              '🏦', 102),
  ('uncategorized',      'Uncategorized',        'Other',              '❓', 110)
ON CONFLICT DO NOTHING;
