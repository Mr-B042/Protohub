-- Flag orders that were RECOVERED from an outage capture: the customer hit submit
-- while the API was unreachable, the submission was saved straight to Supabase
-- (abandoned_carts.outage_captured), and cart-auto-submit reconciled it into an order
-- later. These are higher-risk (no live confirmation at submit time), so the team
-- should be able to spot and verify them — hence a queryable, badge-able flag.
alter table public.orders
  add column if not exists outage_recovered boolean not null default false;
