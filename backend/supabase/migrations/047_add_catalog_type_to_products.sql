alter table if exists public.products
  add column if not exists catalog_type text not null default 'standard';
alter table if exists public.products
  drop constraint if exists products_catalog_type_check;
alter table if exists public.products
  add constraint products_catalog_type_check
  check (catalog_type in ('standard', 'combo_only'));
update public.products
set catalog_type = 'standard'
where catalog_type is null or trim(catalog_type) = '';
