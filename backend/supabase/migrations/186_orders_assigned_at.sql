-- 186: record WHEN an order was assigned/claimed.
--
-- Nothing recorded this before: orders carries assigned_rep_id and
-- assigned_by_user_id but no timestamp, and order_audit only logs status
-- transitions. So "show me what each rep picked up on each day" was not
-- answerable from the data at all.
--
-- Deliberately NOT backfilled. The pick date of an already-claimed order is
-- genuinely unknown, and inventing one (created_at, updated_at) would put
-- fake days in a report meant to show real daily pick activity. Rows with a
-- NULL assigned_at are grouped separately and labelled as not recorded.
alter table public.orders add column if not exists assigned_at timestamptz;

comment on column public.orders.assigned_at is
  'When assigned_rep_id was last set/changed. NULL = assigned before this was tracked (migration 186).';

-- Serves "this rep''s picks, newest day first" on the Recovery Rep dashboard.
create index if not exists idx_orders_assigned_at
  on public.orders (org_id, assigned_rep_id, assigned_at desc);
