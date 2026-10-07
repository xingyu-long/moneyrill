-- Categories live in groups, and groups belong to one of three types: income, expense, transfer.
-- Additive: categories.group_name stays (kept in step by the app, so transaction queries are unchanged).
CREATE TABLE IF NOT EXISTS category_groups (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL CHECK (type IN ('income','expense','transfer')),
  name        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS category_groups_name ON category_groups(type, lower(name));
ALTER TABLE categories ADD COLUMN IF NOT EXISTS group_id bigint REFERENCES category_groups(id);

-- Groups from the first release, then the example groups.
INSERT INTO category_groups(type, name, sort_order) VALUES
  ('income',   'Income',             10),
  ('transfer', 'Transfers',          10),
  ('expense',  'Gifts & Donations',  10),
  ('expense',  'Auto & Transport',   20),
  ('expense',  'Housing',            30),
  ('expense',  'Food & Dining',      40),
  ('expense',  'Shopping',           50),
  ('expense',  'Bills & Utilities',  60),
  ('expense',  'Travel & Lifestyle', 70),
  ('expense',  'Health',             80),
  ('expense',  'Other',              90)
ON CONFLICT DO NOTHING;
-- Anything a user created under another group name keeps it, as an expense group.
INSERT INTO category_groups(type, name, sort_order)
  SELECT 'expense', g, 100 + row_number() OVER (ORDER BY g)
  FROM (SELECT DISTINCT group_name AS g FROM categories) x
  WHERE NOT EXISTS (SELECT 1 FROM category_groups cg WHERE lower(cg.name) = lower(x.g))
ON CONFLICT DO NOTHING;
UPDATE categories c SET group_id = (
  SELECT g.id FROM category_groups g WHERE lower(g.name) = lower(c.group_name)
  ORDER BY g.type = 'expense' LIMIT 1) WHERE c.group_id IS NULL;

-- A few more examples (the first release already seeded the rest).
INSERT INTO categories(key, name, group_name, emoji, sort_order, group_id)
SELECT v.key, v.name, g.name, v.emoji, v.sort_order, g.id
FROM (VALUES
  ('business_income',   'Business Income',     'income',  'Income',            '💰', 13),
  ('charity',           'Charity',             'expense', 'Gifts & Donations', '🎗️', 10),
  ('gifts',             'Gifts',               'expense', 'Gifts & Donations', '🎁', 11),
  ('auto_payment',      'Auto Payment',        'expense', 'Auto & Transport',  '🚘', 71),
  ('public_transit',    'Public Transit',      'expense', 'Auto & Transport',  '🚌', 72),
  ('gas_ev',            'Gas & EV Charging',   'expense', 'Auto & Transport',  '⛽', 73),
  ('auto_maintenance',  'Auto Maintenance',    'expense', 'Auto & Transport',  '🔧', 74),
  ('parking_tolls',     'Parking & Tolls',     'expense', 'Auto & Transport',  '🅿️', 75),
  ('taxi',              'Taxi & Ride Shares',  'expense', 'Auto & Transport',  '🚕', 76),
  ('mortgage',          'Mortgage',            'expense', 'Housing',           '🏡', 49),
  ('coffee_shops',      'Coffee Shops',        'expense', 'Food & Dining',     '☕', 32),
  ('phone',             'Phone',               'expense', 'Bills & Utilities', '📱', 62)
) AS v(key, name, type, grp, emoji, sort_order)
JOIN category_groups g ON g.type = v.type AND lower(g.name) = lower(v.grp)
ON CONFLICT DO NOTHING;
