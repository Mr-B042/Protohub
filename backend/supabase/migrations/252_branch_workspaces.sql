-- Branch workspaces: one organisation can operate several country/branch
-- workspaces without mixing operational records. The catalogue remains shared;
-- orders, agents, stock movements and carts belong to one branch.
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  country_code text not null,
  country_name text not null,
  name text not null,
  state_or_region text,
  city text,
  currency text not null default 'NGN',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

alter table public.orders add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.agents add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.agent_stock add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.stock_movements add column if not exists branch_id uuid references public.branches(id) on delete restrict;
alter table public.abandoned_carts add column if not exists branch_id uuid references public.branches(id) on delete restrict;

create index if not exists idx_branches_org_active on public.branches(org_id, active, country_name, name);
create index if not exists idx_orders_org_branch_created on public.orders(org_id, branch_id, created_at desc);
create index if not exists idx_agents_org_branch on public.agents(org_id, branch_id, status);
create index if not exists idx_agent_stock_branch on public.agent_stock(branch_id, agent_id, product_id);
create index if not exists idx_stock_movements_branch on public.stock_movements(org_id, branch_id, created_at desc);
create index if not exists idx_carts_org_branch on public.abandoned_carts(org_id, branch_id, created_at desc);

-- Preserve all existing data in one explicit default workspace. This is
-- intentionally idempotent so a retry cannot create duplicate branches.
insert into public.branches (org_id, country_code, country_name, name, state_or_region, city, currency)
select o.id, 'NG', 'Nigeria', 'Nigeria Operations', null, null, 'NGN'
from public.organizations o
where not exists (
  select 1 from public.branches b
  where b.org_id = o.id and b.name = 'Nigeria Operations'
);

update public.orders o
set branch_id = b.id
from public.branches b
where o.org_id = b.org_id and b.name = 'Nigeria Operations' and o.branch_id is null;

update public.agents a
set branch_id = b.id
from public.branches b
where a.org_id = b.org_id and b.name = 'Nigeria Operations' and a.branch_id is null;

update public.agent_stock s
set branch_id = a.branch_id
from public.agents a
where s.agent_id = a.id and s.branch_id is null;

update public.stock_movements m
set branch_id = b.id
from public.branches b
where m.org_id = b.org_id and b.name = 'Nigeria Operations' and m.branch_id is null;

update public.abandoned_carts c
set branch_id = b.id
from public.branches b
where c.org_id = b.org_id and b.name = 'Nigeria Operations' and c.branch_id is null;

alter table public.orders alter column branch_id set not null;
alter table public.agents alter column branch_id set not null;
alter table public.agent_stock alter column branch_id set not null;
alter table public.stock_movements alter column branch_id set not null;
alter table public.abandoned_carts alter column branch_id set not null;

alter table public.branches enable row level security;
create policy branches_org_read on public.branches for select using (org_id = private.auth_org_id());
create policy branches_org_write on public.branches for all using (org_id = private.auth_org_id()) with check (org_id = private.auth_org_id());
