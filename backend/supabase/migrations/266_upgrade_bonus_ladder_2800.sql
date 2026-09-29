-- Upgrade bonus ladder for the 5-in-1 Corner Racks and Multi Corner Storage Shelf.
-- The configured amount is ₦2,800 for each quantity step.

update public.products
set bonus_config = jsonb_set(
  coalesce(bonus_config, '{}'::jsonb),
  '{upgradeBonuses}',
  jsonb_build_array(
    jsonb_build_object('fromQty', 1, 'toQty', 2, 'amount', 2800),
    jsonb_build_object('fromQty', 2, 'toQty', 3, 'amount', 2800),
    jsonb_build_object('fromQty', 3, 'toQty', 4, 'amount', 2800),
    jsonb_build_object('fromQty', 4, 'toQty', 5, 'amount', 2800),
    jsonb_build_object('fromQty', 1, 'toQty', 3, 'amount', 5600),
    jsonb_build_object('fromQty', 2, 'toQty', 4, 'amount', 5600),
    jsonb_build_object('fromQty', 3, 'toQty', 5, 'amount', 5600),
    jsonb_build_object('fromQty', 1, 'toQty', 4, 'amount', 8400),
    jsonb_build_object('fromQty', 2, 'toQty', 5, 'amount', 8400),
    jsonb_build_object('fromQty', 1, 'toQty', 5, 'amount', 11200),
    jsonb_build_object('fromQty', 3, 'toQty', 6, 'amount', 8400)
  ),
  true
)
where id in (
  '3ea9db9e-3802-43e2-ba28-de80e3da8c5b',
  '551f40ae-33a6-49d5-a9ad-f030ece24a7b'
);
