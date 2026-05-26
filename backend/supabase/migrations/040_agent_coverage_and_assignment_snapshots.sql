alter table public.agents
  add column if not exists address text,
  add column if not exists whatsapp_phone text,
  add column if not exists primary_base_state text;
update public.agents
set primary_base_state = coalesce(nullif(primary_base_state, ''), nullif(zone, ''))
where coalesce(nullif(primary_base_state, ''), '') = '';
create table if not exists public.agent_coverage (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  state text not null,
  city text not null default '',
  coverage_type text not null default 'local_delivery' check (coverage_type in ('local_delivery', 'interstate_delivery', 'pickup_hub')),
  priority integer not null default 100,
  active boolean not null default true,
  sla_days integer not null default 1 check (sla_days >= 0),
  delivery_fee_rule text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, state, city, coverage_type)
);
create index if not exists idx_agent_coverage_agent on public.agent_coverage(agent_id);
create index if not exists idx_agent_coverage_state_active on public.agent_coverage(state, active);
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'agent_coverage_updated_at'
  ) then
    create trigger agent_coverage_updated_at
      before update on public.agent_coverage
      for each row execute procedure public.set_updated_at();
  end if;
end $$;
insert into public.agent_coverage (agent_id, state, city, coverage_type, priority, active, sla_days)
select
  a.id,
  coalesce(nullif(a.primary_base_state, ''), nullif(a.zone, ''), 'Unassigned'),
  '',
  'local_delivery',
  100,
  true,
  1
from public.agents a
where not exists (
  select 1 from public.agent_coverage c where c.agent_id = a.id
);
alter table public.orders
  add column if not exists agent_name_snapshot text,
  add column if not exists agent_phone_snapshot text,
  add column if not exists agent_base_state_snapshot text,
  add column if not exists agent_coverage_state_snapshot text,
  add column if not exists agent_coverage_city_snapshot text;
update public.orders o
set
  agent_name_snapshot = coalesce(o.agent_name_snapshot, a.name),
  agent_phone_snapshot = coalesce(o.agent_phone_snapshot, a.phone),
  agent_base_state_snapshot = coalesce(o.agent_base_state_snapshot, a.primary_base_state, a.zone)
from public.agents a
where o.agent_id = a.id
  and (
    o.agent_name_snapshot is null
    or o.agent_phone_snapshot is null
    or o.agent_base_state_snapshot is null
  );
