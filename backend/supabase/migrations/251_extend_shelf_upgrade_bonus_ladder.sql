-- Extend Multi Corner Storage Shelf upgrade bonuses through 5pcs and cover
-- order #4092's recorded 3 -> 6pcs upgrade.
--
-- The 1-4 ladder is cumulative, so the new 5pc paths keep that same model.
-- Order #4092 moved from N125,500 to N250,000; its N12,450 rule is 10% of
-- the actual N124,500 incremental order value.

update public.products
set bonus_config = jsonb_set(
  coalesce(bonus_config, '{}'::jsonb),
  '{upgradeBonuses}',
  jsonb_build_array(
    jsonb_build_object('fromQty', 1, 'toQty', 2, 'amount', 4600),
    jsonb_build_object('fromQty', 2, 'toQty', 3, 'amount', 4000),
    jsonb_build_object('fromQty', 3, 'toQty', 4, 'amount', 3000),
    jsonb_build_object('fromQty', 4, 'toQty', 5, 'amount', 3000),
    jsonb_build_object('fromQty', 1, 'toQty', 3, 'amount', 8600),
    jsonb_build_object('fromQty', 2, 'toQty', 4, 'amount', 7000),
    jsonb_build_object('fromQty', 3, 'toQty', 5, 'amount', 6000),
    jsonb_build_object('fromQty', 1, 'toQty', 4, 'amount', 11600),
    jsonb_build_object('fromQty', 2, 'toQty', 5, 'amount', 10000),
    jsonb_build_object('fromQty', 1, 'toQty', 5, 'amount', 14600),
    jsonb_build_object('fromQty', 3, 'toQty', 6, 'amount', 12450)
  ),
  true
)
where id = '551f40ae-33a6-49d5-a9ad-f030ece24a7b';

