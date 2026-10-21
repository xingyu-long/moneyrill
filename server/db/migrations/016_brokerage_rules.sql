-- Rules can categorise brokerage activity too. As on `transactions`, a rule's result is kept apart from the owner's
-- own choice (category_id), so the order is: your choice, then a rule, then not counted. Additive only.
ALTER TABLE investment_transactions ADD COLUMN IF NOT EXISTS rule_id bigint REFERENCES rules(id) ON DELETE SET NULL;
ALTER TABLE investment_transactions ADD COLUMN IF NOT EXISTS rule_category_id bigint REFERENCES categories(id) ON DELETE SET NULL;
