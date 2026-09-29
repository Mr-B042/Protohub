-- Correct the previous ladder update: only the 1 -> 2 amount is fixed at
-- ₦2,800. All other upgrade amounts remain product-specific calculations.

update public.products
set bonus_config = jsonb_set(
  coalesce(bonus_config, '{}'::jsonb), '{upgradeBonuses}',
  jsonb_build_array(
    jsonb_build_object('fromQty', 1, 'toQty', 2, 'amount', 2800),
    jsonb_build_object('fromQty', 2, 'toQty', 3, 'amount', 3000),
    jsonb_build_object('fromQty', 3, 'toQty', 4, 'amount', 3150),
    jsonb_build_object('fromQty', 1, 'toQty', 3, 'amount', 5900),
    jsonb_build_object('fromQty', 2, 'toQty', 4, 'amount', 6150),
    jsonb_build_object('fromQty', 3, 'toQty', 5, 'amount', 5600),
    jsonb_build_object('fromQty', 1, 'toQty', 4, 'amount', 9050)
  ), true
)
where id = '3ea9db9e-3802-43e2-ba28-de80e3da8c5b';

update public.products
set bonus_config = jsonb_set(
  coalesce(bonus_config, '{}'::jsonb), '{upgradeBonuses}',
  jsonb_build_array(
    jsonb_build_object('fromQty', 1, 'toQty', 2, 'amount', 2800),
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
  ), true
)
where id = '551f40ae-33a6-49d5-a9ad-f030ece24a7b';
