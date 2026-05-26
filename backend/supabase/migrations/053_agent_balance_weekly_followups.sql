create table if not exists public.agent_balance_weekly_followups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  week_start date not null,
  agent_id uuid not null references public.agents(id) on delete cascade,
  agent_location_id uuid not null references public.agent_locations(id) on delete cascade,
  last_sent_at timestamptz,
  sent_channel text check (sent_channel in ('whatsapp', 'call', 'manual')),
  last_sent_by_user_id uuid references public.users(id) on delete set null,
  last_sent_by_name text,
  agent_confirmed_at timestamptz,
  agent_confirmation_note text,
  agent_confirmed_by_user_id uuid references public.users(id) on delete set null,
  agent_confirmed_by_name text,
  shortage_reported_at timestamptz,
  shortage_note text,
  shortage_reported_by_user_id uuid references public.users(id) on delete set null,
  shortage_reported_by_name text,
  last_action_at timestamptz,
  last_action_type text check (last_action_type in ('mark_sent', 'mark_confirmed', 'report_shortage')),
  last_action_by_user_id uuid references public.users(id) on delete set null,
  last_action_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, week_start, agent_id, agent_location_id)
);
create trigger agent_balance_weekly_followups_updated_at
  before update on public.agent_balance_weekly_followups
  for each row execute function public.set_updated_at();
create index if not exists idx_agent_balance_weekly_followups_org_week
  on public.agent_balance_weekly_followups(org_id, week_start);
create index if not exists idx_agent_balance_weekly_followups_org_agent
  on public.agent_balance_weekly_followups(org_id, agent_id, agent_location_id);
alter table public.agent_balance_weekly_followups enable row level security;
create policy "Staff can see weekly balance followups"
  on public.agent_balance_weekly_followups for select
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin', 'Manager', 'Sales Rep', 'Inventory Manager'));
create policy "Staff can manage weekly balance followups"
  on public.agent_balance_weekly_followups for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin', 'Manager', 'Sales Rep', 'Inventory Manager'));
