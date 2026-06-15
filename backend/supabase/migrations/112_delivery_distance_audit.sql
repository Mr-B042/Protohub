alter table public.agent_locations
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.orders
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geo_accuracy text,
  add column if not exists geo_source text;

create table if not exists public.delivery_distance_audits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  agent_location_id uuid references public.agent_locations(id) on delete set null,
  origin_latitude double precision not null,
  origin_longitude double precision not null,
  destination_latitude double precision not null,
  destination_longitude double precision not null,
  distance_meters integer not null,
  duration_seconds integer,
  straight_line_meters integer,
  provider text not null default 'estimate',
  map_url text,
  embed_map_url text,
  expected_fee numeric(12,2),
  charged_fee numeric(12,2),
  variance_amount numeric(12,2),
  variance_percent numeric(8,2),
  risk text not null default 'review' check (risk in ('fair', 'watch', 'suspicious', 'missing')),
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, order_id)
);

create index if not exists idx_delivery_distance_audits_org_created
  on public.delivery_distance_audits(org_id, created_at desc);
create index if not exists idx_delivery_distance_audits_order
  on public.delivery_distance_audits(order_id);
create index if not exists idx_delivery_distance_audits_agent
  on public.delivery_distance_audits(agent_id);
create index if not exists idx_delivery_distance_audits_risk
  on public.delivery_distance_audits(org_id, risk);

drop trigger if exists delivery_distance_audits_updated_at on public.delivery_distance_audits;
create trigger delivery_distance_audits_updated_at
  before update on public.delivery_distance_audits
  for each row execute function public.set_updated_at();

alter table public.delivery_distance_audits enable row level security;

drop policy if exists "org read delivery distance audits" on public.delivery_distance_audits;
create policy "org read delivery distance audits"
  on public.delivery_distance_audits
  for select
  using (org_id = private.auth_org_id() and private.auth_user_role() in ('Owner', 'Admin', 'Manager', 'Inventory Manager'));

drop policy if exists "org manage delivery distance audits" on public.delivery_distance_audits;
create policy "org manage delivery distance audits"
  on public.delivery_distance_audits
  for all
  using (org_id = private.auth_org_id() and private.auth_user_role() in ('Owner', 'Admin', 'Manager'))
  with check (org_id = private.auth_org_id() and private.auth_user_role() in ('Owner', 'Admin', 'Manager'));
