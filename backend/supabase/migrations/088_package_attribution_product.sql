-- Migration 088: attribution_product_id on product_packages
--
-- Lets a package live under one product in the catalog but ATTRIBUTE its
-- orders to a different product. Use case: a combo bundle (Best Value 💎,
-- Small Pack, etc.) sits visually under "Edge Brusher Max" so admins keep
-- them organized together, but at order time the order record stamps with
-- "Home Cleaning Tools" (the real combo product) for correct attribution
-- in analytics, inventory roll-up, and customer-facing display.
--
-- This is the SIMPLE walk-around to the "combos buried under wrong product"
-- problem. Distinct from:
--   - companion_products on a package (auto-bundle silent companions)
--   - cross_sell_product_ids on a product (add-ons at checkout)
--   - alternative_product_ids on a product (either/or picker — superseded
--     by this simpler approach; kept as additive column but no longer used)
--
-- NULL means "no override — attribute to the parent product as today."

alter table public.product_packages
  add column if not exists attribution_product_id uuid
    references public.products(id) on delete set null;

-- Index for the rare reverse lookup "which packages attribute TO this product?".
create index if not exists idx_product_packages_attribution_product_id
  on public.product_packages (attribution_product_id)
  where attribution_product_id is not null;
