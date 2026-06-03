-- Migration 097: POD batch unit-economics + a CONFIGURABLE N-tier status cost model.
--
-- A "batch" = a named campaign cohort of orders (orders.batch_id). Its economics use
-- manual per-batch cost assumptions (ad_spend, product_cost_per_set, delivery_cost_per_order)
-- and a configurable set of cost TIERS — ANY number, not a fixed 3. Each CRM order status
-- maps to a tier; each tier carries its own cost rules (earns revenue? charge ad / product /
-- delivery?). The calc engine just sums per the tier's flags, so adding a 4th/5th tier
-- (e.g. "Returned — restocked") needs no code change.
--
-- This is a planning/analysis lens. The actuals-based finance model
-- (computeBreakEven / summarizeRecognizedProfit) is untouched and remains the source of
-- truth for recognised P&L. org_id scoped, RLS on (backend uses service-role which
-- bypasses RLS; policies are defense-in-depth for direct authenticated/anon access).

-- 1) Batches ---------------------------------------------------------------------------
create table if not exists public.batch_economics (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  label                   text not null default 'Untitled batch',
  period_start            date,
  period_end              date,
  ad_spend                numeric not null default 0,
  product_cost_per_set    numeric not null default 0,
  delivery_cost_per_order numeric not null default 0,
  status                  text not null default 'open',   -- 'open' | 'closed'
  created_at              timestamp with time zone not null default now(),
  updated_at              timestamp with time zone not null default now()
);
create index if not exists idx_batch_economics_org on public.batch_economics (org_id, created_at desc);

-- 2) Link orders to a batch (nullable). A batch's orders = orders where batch_id matches;
--    orders are never duplicated. on delete set null so deleting a batch keeps its orders.
alter table public.orders add column if not exists batch_id uuid references public.batch_economics(id) on delete set null;
create index if not exists idx_orders_batch on public.orders (batch_id) where batch_id is not null;

-- 3) Configurable cost TIERS (any number per org) ------------------------------------
create table if not exists public.batch_cost_tiers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  tier_key        text not null,                  -- stable key, e.g. 'delivered'
  label           text not null,
  earns_revenue   boolean not null default false,
  charge_ad       boolean not null default true,  -- ad is sunk on every order, all tiers
  charge_product  boolean not null default false,
  charge_delivery boolean not null default false,
  sort_order      integer not null default 0,
  created_at      timestamp with time zone not null default now(),
  updated_at      timestamp with time zone not null default now(),
  unique (org_id, tier_key)
);
create index if not exists idx_batch_cost_tiers_org on public.batch_cost_tiers (org_id, sort_order);

-- 4) Status -> tier map (configurable) + an "open" flag (could still deliver — drives the
--    best-case ceiling: open statuses are re-tiered to the revenue-earning tier).
create table if not exists public.batch_status_tier_map (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  order_status  text not null,
  tier_key      text not null,
  is_open       boolean not null default false,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),
  unique (org_id, order_status)
);
create index if not exists idx_batch_status_tier_map_org on public.batch_status_tier_map (org_id);

-- 5) RLS -----------------------------------------------------------------------------
alter table public.batch_economics       enable row level security;
alter table public.batch_cost_tiers      enable row level security;
alter table public.batch_status_tier_map enable row level security;
create policy "org rw batch_economics"       on public.batch_economics       for all using (org_id = private.auth_org_id()) with check (org_id = private.auth_org_id());
create policy "org rw batch_cost_tiers"      on public.batch_cost_tiers      for all using (org_id = private.auth_org_id()) with check (org_id = private.auth_org_id());
create policy "org rw batch_status_tier_map" on public.batch_status_tier_map for all using (org_id = private.auth_org_id()) with check (org_id = private.auth_org_id());

-- 6) Seed sensible defaults for every existing org (backend also ensures these exist on
--    first access, for orgs created later). Idempotent.
insert into public.batch_cost_tiers (org_id, tier_key, label, earns_revenue, charge_ad, charge_product, charge_delivery, sort_order)
select o.id, t.tier_key, t.label, t.earns_revenue, t.charge_ad, t.charge_product, t.charge_delivery, t.sort_order
from public.organizations o
cross join (values
  ('delivered',           'Delivered',             true,  true, true,  true,  0),
  ('dispatched_failed',   'Dispatched — failed',   false, true, false, true,  1),
  ('pre_dispatch_failed', 'Pre-dispatch — failed', false, true, false, false, 2)
) as t(tier_key, label, earns_revenue, charge_ad, charge_product, charge_delivery, sort_order)
on conflict (org_id, tier_key) do nothing;

insert into public.batch_status_tier_map (org_id, order_status, tier_key, is_open)
select o.id, m.order_status, m.tier_key, m.is_open
from public.organizations o
cross join (values
  ('Delivered',  'delivered',           false),
  ('Dispatched', 'dispatched_failed',   true),
  ('Failed',     'dispatched_failed',   false),
  ('New',        'pre_dispatch_failed', true),
  ('Confirmed',  'pre_dispatch_failed', true),
  ('In Process', 'pre_dispatch_failed', true),
  ('Postponed',  'pre_dispatch_failed', true),
  ('Cancelled',  'pre_dispatch_failed', false)
) as m(order_status, tier_key, is_open)
on conflict (org_id, order_status) do nothing;
