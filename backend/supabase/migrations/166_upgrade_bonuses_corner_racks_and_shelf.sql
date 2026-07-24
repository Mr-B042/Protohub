-- Migration 166: upgrade-bonus config for 5-in-1 Corner Racks and Multi
-- Corner Storage Shelf.
--
-- Both products use a 1-4pc package ladder (Lite/Ultra/Ultra Pro/Ultra Max
-- and Starter/Basic/Family/Premium), unlike the standard 3/5/7/10/12/15pc
-- ladder most products use - so the default upgradeBonuses tiers never
-- matched and bonus_config was null on both. This is why orders #2129 and
-- #2483's corrected 1->2pcs upsells weren't earning any bonus.
--
-- Tiers are 10% of the incremental order value each upgrade adds - the
-- same crossSellPercent rate this app already uses for cross-sell bonuses
-- on every other product, applied here to the upgrade increment instead.

update public.products
set bonus_config = jsonb_build_object(
  'upgradeBonuses', jsonb_build_array(
    jsonb_build_object('fromQty', 1, 'toQty', 2, 'amount', 2900),
    jsonb_build_object('fromQty', 2, 'toQty', 3, 'amount', 3000),
    jsonb_build_object('fromQty', 3, 'toQty', 4, 'amount', 3150),
    jsonb_build_object('fromQty', 1, 'toQty', 3, 'amount', 5900),
    jsonb_build_object('fromQty', 2, 'toQty', 4, 'amount', 6150),
    jsonb_build_object('fromQty', 1, 'toQty', 4, 'amount', 9050)
  )
)
where id = '3ea9db9e-3802-43e2-ba28-de80e3da8c5b'; -- 5-in-1 Corner Racks

update public.products
set bonus_config = jsonb_build_object(
  'upgradeBonuses', jsonb_build_array(
    jsonb_build_object('fromQty', 1, 'toQty', 2, 'amount', 4600),
    jsonb_build_object('fromQty', 2, 'toQty', 3, 'amount', 4000),
    jsonb_build_object('fromQty', 3, 'toQty', 4, 'amount', 3000),
    jsonb_build_object('fromQty', 1, 'toQty', 3, 'amount', 8600),
    jsonb_build_object('fromQty', 2, 'toQty', 4, 'amount', 7000),
    jsonb_build_object('fromQty', 1, 'toQty', 4, 'amount', 11600)
  )
)
where id = '551f40ae-33a6-49d5-a9ad-f030ece24a7b'; -- Multi Corner Storage Shelf
