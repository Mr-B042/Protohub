-- Migration 109: group packages into selectable public order-form sets.
--
-- Existing products keep working because every package defaults to "Default".
-- New embed / marketer links can choose one package_set so the same product can
-- have different package views without cloning the product itself.

alter table public.product_packages
  add column if not exists package_set text not null default 'Default';

update public.product_packages
set package_set = 'Default'
where package_set is null or btrim(package_set) = '';

create index if not exists idx_product_packages_product_set_order
  on public.product_packages (product_id, package_set, display_order);

alter table public.marketing_link_variants
  add column if not exists package_set text;

create index if not exists idx_marketing_link_variants_org_product_set
  on public.marketing_link_variants (org_id, product_id, package_set);
