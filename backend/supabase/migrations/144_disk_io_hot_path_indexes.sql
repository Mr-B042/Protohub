-- Migration 144: reduce Disk IO pressure on the busiest dashboard paths.
-- These indexes support incremental order polling and Live Form Pulse range
-- reads so Postgres does not repeatedly scan broad order/event ranges.

create index if not exists idx_orders_org_updated_at
  on public.orders (org_id, updated_at desc);

create index if not exists idx_orders_org_rep_updated_at
  on public.orders (org_id, assigned_rep_id, updated_at desc)
  where assigned_rep_id is not null;

create index if not exists idx_cart_journey_events_org_created_at
  on public.cart_journey_events (org_id, created_at desc);

create index if not exists idx_cart_journey_events_org_event_type_created_at
  on public.cart_journey_events (org_id, event_type, created_at desc);
