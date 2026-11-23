-- Stock Intelligence (Product Trend › Stock Intelligence, Bright's brief and
-- design, 23 Nov 2026).
--
-- Two settings tables and two alert types. Everything else on the tab is
-- worked out from orders, agent hub stock and waybills that already exist.
--
-- 1. stock_supply_routes: where a state's RESTOCK comes from. Order routing is
--    untouched (an order still goes only to an in-state hub). A row says
--    "agents in dest_state are restocked from hubs in source_state" (or from
--    the main warehouse when source_state is null), priority 1 first, 2 as the
--    fallback. product_id null = every product; a product row overrides the
--    general rows for that product. A state with no row is restocked from the
--    main warehouse.
--
-- 2. stock_lead_time_settings: the Owner's overrides for lead time (days from
--    sending stock to it arriving) and safety stock (days of sales kept in
--    hand). Without a row, lead time is measured from past received waybills
--    and safety stock is 2 days.

create table if not exists public.stock_supply_routes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  dest_state text not null,
  product_id uuid references public.products(id) on delete cascade,
  source_state text,
  priority smallint not null default 1 check (priority between 1 and 3),
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_state is null or source_state <> dest_state)
);

create unique index if not exists stock_supply_routes_one_per_priority
  on public.stock_supply_routes (branch_id, dest_state, coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid), priority);

create table if not exists public.stock_lead_time_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  agent_location_id uuid references public.agent_locations(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  lead_time_days numeric(5,1) check (lead_time_days is null or (lead_time_days > 0 and lead_time_days <= 60)),
  safety_days numeric(5,1) check (safety_days is null or (safety_days >= 0 and safety_days <= 30)),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create unique index if not exists stock_lead_time_settings_one
  on public.stock_lead_time_settings (
    branch_id,
    coalesce(agent_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- The API uses the service role; these stop any direct client reading across orgs.
alter table public.stock_supply_routes enable row level security;
alter table public.stock_lead_time_settings enable row level security;

-- Bright's routes, filled in once for every branch named "Nigeria Operations".
-- Northern states: Abuja hub. South-West: Ibadan (Oyo) first, Ogun as the
-- fallback. Lagos, Abuja, Port Harcourt (Rivers), Benin (Edo) and Delta get
-- waybills straight from the main warehouse.
insert into public.stock_supply_routes (org_id, branch_id, dest_state, source_state, priority)
select b.org_id, b.id, r.dest_state, r.source_state, r.priority
from public.branches b
cross join (values
  ('Lagos', null, 1), ('FCT Abuja', null, 1), ('Rivers', null, 1), ('Edo', null, 1), ('Delta', null, 1),
  ('Benue', 'FCT Abuja', 1), ('Kogi', 'FCT Abuja', 1), ('Kwara', 'FCT Abuja', 1), ('Nasarawa', 'FCT Abuja', 1),
  ('Niger', 'FCT Abuja', 1), ('Plateau', 'FCT Abuja', 1),
  ('Adamawa', 'FCT Abuja', 1), ('Bauchi', 'FCT Abuja', 1), ('Borno', 'FCT Abuja', 1), ('Gombe', 'FCT Abuja', 1),
  ('Taraba', 'FCT Abuja', 1), ('Yobe', 'FCT Abuja', 1),
  ('Jigawa', 'FCT Abuja', 1), ('Kaduna', 'FCT Abuja', 1), ('Kano', 'FCT Abuja', 1), ('Katsina', 'FCT Abuja', 1),
  ('Kebbi', 'FCT Abuja', 1), ('Sokoto', 'FCT Abuja', 1), ('Zamfara', 'FCT Abuja', 1),
  ('Oyo', null, 1), ('Oyo', 'Ogun', 2),
  ('Osun', 'Oyo', 1), ('Osun', 'Ogun', 2),
  ('Ekiti', 'Oyo', 1), ('Ekiti', 'Ogun', 2),
  ('Ondo', 'Oyo', 1), ('Ondo', 'Ogun', 2),
  ('Ogun', null, 1)
) as r(dest_state, source_state, priority)
where b.name = 'Nigeria Operations'
on conflict do nothing;

-- New alert types (system_notifications.type is an enum - every new kind
-- must be added or the insert fails).
alter type public.notification_type add value if not exists 'stock_hub_risk';
alter type public.notification_type add value if not exists 'stock_transfer_chance';
