create table if not exists public.user_agent_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (org_id, user_id, agent_id)
);
create index if not exists idx_user_agent_assignments_org_user
  on public.user_agent_assignments(org_id, user_id);
create index if not exists idx_user_agent_assignments_org_agent
  on public.user_agent_assignments(org_id, agent_id);
alter table public.user_agent_assignments enable row level security;
create policy "Staff can see agent assignments"
  on public.user_agent_assignments for select
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin', 'Manager', 'Sales Rep', 'Inventory Manager'));
create policy "Owner admin can manage agent assignments"
  on public.user_agent_assignments for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));
alter table public.users
  drop constraint if exists users_agent_balance_scope_mode_check;
alter table public.users
  add constraint users_agent_balance_scope_mode_check
  check (agent_balance_scope_mode in ('all', 'states', 'agents', 'assigned_agents'));
