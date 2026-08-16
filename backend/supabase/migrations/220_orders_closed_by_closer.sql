-- Permanent Sales Closer attribution for Convert to Order. assigned_rep_id
-- is mutable (reassigned via PATCH /:id for delivery/follow-up handoffs,
-- backend/src/routes/orders.ts) so it cannot carry "who originally closed
-- this order" - that needs its own column, following the *_by_user_id /
-- *_by_name snapshot convention already used for agent confirmation
-- (migration 053) rather than a read of a field that changes later.
alter table public.orders
  add column if not exists closed_by_closer_id uuid references public.users(id) on delete set null,
  add column if not exists closed_by_closer_name text;

create index if not exists idx_orders_closed_by_closer
  on public.orders(org_id, closed_by_closer_id)
  where closed_by_closer_id is not null;
