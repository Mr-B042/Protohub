create table if not exists public.agent_balance_weekly_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  week_start date not null,
  agent_id uuid not null references public.agents(id) on delete cascade,
  agent_location_id uuid not null references public.agent_locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  opening_quantity integer not null default 0,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, week_start, agent_id, agent_location_id, product_id)
);

create trigger agent_balance_weekly_snapshots_updated_at
  before update on public.agent_balance_weekly_snapshots
  for each row execute function public.set_updated_at();

create index if not exists idx_agent_balance_weekly_snapshots_org_week
  on public.agent_balance_weekly_snapshots(org_id, week_start);

create index if not exists idx_agent_balance_weekly_snapshots_org_agent
  on public.agent_balance_weekly_snapshots(org_id, agent_id, agent_location_id);

alter table public.agent_balance_weekly_snapshots enable row level security;

create policy "Staff can see weekly balance snapshots"
  on public.agent_balance_weekly_snapshots for select
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin', 'Manager', 'Sales Rep', 'Inventory Manager'));

create policy "Staff can manage weekly balance snapshots"
  on public.agent_balance_weekly_snapshots for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin', 'Manager', 'Sales Rep', 'Inventory Manager'));
