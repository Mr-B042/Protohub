-- A permanent record of every deleted order (Bright, 5 Oct 2026).
--
-- Order #4844 (a repeat form from a customer who already had #4819) was
-- deleted at 05:03 on 5 Oct and nobody could say by whom: the delete route
-- writes an order_audit row, but deleting the order wipes that row with it,
-- and its cart kept saying "Converted" with no order behind it. This table has
-- no link to orders, so the record stays after the order is gone.
create table if not exists public.deleted_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  branch_id uuid,
  order_id text not null,
  source_cart_id text,
  customer text,
  phone text,
  product_name text,
  amount numeric,
  status text,
  deleted_by uuid,
  deleted_by_name text,
  deleted_at timestamptz not null default now(),
  note text,
  order_snapshot jsonb not null default '{}'::jsonb
);

create index if not exists deleted_orders_org_cart_idx on public.deleted_orders (org_id, source_cart_id) where source_cart_id is not null;
create index if not exists deleted_orders_org_order_idx on public.deleted_orders (org_id, order_id);

alter table public.deleted_orders enable row level security;
create policy "deleted orders read" on public.deleted_orders
  for select to authenticated using (org_id = private.auth_org_id());

notify pgrst, 'reload schema';
