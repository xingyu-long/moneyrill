-- Income categories for money you record by hand: RSU vests, 401(k) contributions and the like.
-- They match the names used in Monarch, so a later Monarch import reuses them. Additive only.
INSERT INTO categories(key, name, group_name, emoji, sort_order, group_id)
SELECT v.key, v.name, g.name, v.emoji, v.sort_order, g.id
FROM (VALUES
  ('rsu',                'RSU',                     '💹', 14),
  ('espp',               'ESPP',                    '🤑', 15),
  ('401k_contribution',  '401k contribution',       '🌲', 16),
  ('hsa',                'HSA',                     '🏋️', 17),
  ('dividends_gains',    'Dividends & Capital Gains','📈', 18)
) AS v(key, name, emoji, sort_order)
JOIN category_groups g ON g.type = 'income' AND lower(g.name) = 'income'
ON CONFLICT DO NOTHING;
