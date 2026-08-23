-- Freeze what an order actually cost us, on the order.
--
-- ⚠️ Until now nothing stored the cost that applied when an order was sold.
-- Every report recomputed COGS as `quantity x TODAY'S unit_cost`, so editing a
-- product's cost silently restated every order ever sold containing it. Raising
-- the Multi Corner Storage Shelf from ₦11,500 to ₦12,000 would have cut
-- reported profit by ₦48,500 across 90 delivered orders going back to July -
-- weeks already reported on and already used to pay bonuses.
--
-- A delivered order's cost is now settled, the same way a closed week is.

alter table orders add column if not exists cogs_snapshot numeric;
alter table orders add column if not exists cogs_snapshot_at timestamptz;
-- 'delivery' froze automatically when the order was delivered; 'freeze' was a
-- backfill or a deliberate freeze before a cost change. Kept apart so a
-- disputed figure can be traced to how it got there.
alter table orders add column if not exists cogs_snapshot_source text;

comment on column orders.cogs_snapshot is
  'Cost of goods for this order, frozen at the unit costs in force when it was delivered. Reports MUST prefer this over recomputing from current product_pricings, or a cost change restates history.';

create index if not exists orders_cogs_snapshot_idx
  on orders (org_id) where cogs_snapshot is not null;

-- An audit trail for cost changes, so "why did margin move" has an answer.
create table if not exists product_cost_changes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  product_name text not null default '',
  currency text not null default 'NGN',
  previous_unit_cost numeric not null default 0,
  new_unit_cost numeric not null default 0,
  /** Delivered orders frozen at the previous cost before the change landed. */
  orders_frozen integer not null default 0,
  units_frozen numeric not null default 0,
  reason text not null default '',
  changed_by uuid references users(id) on delete set null,
  changed_by_name text not null default '',
  created_at timestamptz not null default now(),
  constraint product_cost_changes_reason_len check (char_length(reason) <= 250)
);

create index if not exists product_cost_changes_org_idx
  on product_cost_changes (org_id, created_at desc);

alter table product_cost_changes enable row level security;

drop policy if exists product_cost_changes_select on product_cost_changes;
create policy product_cost_changes_select on product_cost_changes
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));
