-- Migration 087: alternative_product_ids on products
--
-- Lets a product surface OTHER products' packages on its embed form as
-- alternative choices (not add-ons). The intended use case is selling
-- a single-tool product like Edge Brusher Max alongside a multi-tool
-- combo product (Home Cleaning Tools) on the same form — the customer
-- picks ONE path on the same package picker, but each order attributes
-- correctly to whichever product owns the picked package.
--
-- This is distinct from cross_sell_product_ids (which surfaces other
-- products as add-ons at checkout) and from companion_products on a
-- package (which auto-bundle silent companions into the same order).
--
-- Same shape as cross_sell_product_ids: uuid[] of product ids, NOT NULL
-- with empty-array default so existing rows stay unaffected.

alter table public.products
  add column if not exists alternative_product_ids uuid[] not null default '{}';

-- Index for the rare reverse lookup "which products link TO this product
-- as an alternative?". Cheap GIN over the array.
create index if not exists idx_products_alternative_product_ids
  on public.products using gin (alternative_product_ids);
