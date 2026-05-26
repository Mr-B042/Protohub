alter table if exists public.orders
  add column if not exists source_cart_id text;
create index if not exists orders_org_source_cart_idx
  on public.orders (org_id, source_cart_id)
  where source_cart_id is not null;
