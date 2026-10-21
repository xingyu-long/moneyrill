-- Rules: "if a transaction looks like this, give it that category". A rule's result is kept apart from the
-- owner's own choice (category_id) and from the provider's (auto_category_key), so the order is: your edit,
-- a rule, the automatic category, Uncategorized. Additive only.
CREATE TABLE IF NOT EXISTS rules (
  id bigserial PRIMARY KEY,
  sort_order integer NOT NULL DEFAULT 0,
  conditions jsonb NOT NULL,
  category_id bigint NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  last_applied_at timestamptz,
  last_applied_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS rule_id bigint REFERENCES rules(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS rule_category_id bigint REFERENCES categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS transactions_rule_idx ON transactions(rule_id) WHERE rule_id IS NOT NULL;
