create table if not exists public.agent_locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  name text not null,
  state text not null,
  city text not null default '',
  address text,
  phone_override text,
  active boolean not null default true,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, state, city)
);
create index if not exists idx_agent_locations_agent on public.agent_locations(agent_id);
create index if not exists idx_agent_locations_state_active on public.agent_locations(state, active);
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'agent_locations_updated_at'
  ) then
    create trigger agent_locations_updated_at
      before update on public.agent_locations
      for each row execute procedure public.set_updated_at();
  end if;
end $$;
create table if not exists public.agent_location_stock (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  agent_location_id uuid not null references public.agent_locations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  defective integer not null default 0 check (defective >= 0),
  missing integer not null default 0 check (missing >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_location_id, product_id)
);
create index if not exists idx_agent_location_stock_agent on public.agent_location_stock(agent_id);
create index if not exists idx_agent_location_stock_location on public.agent_location_stock(agent_location_id);
create index if not exists idx_agent_location_stock_product on public.agent_location_stock(product_id);
do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'agent_location_stock_updated_at'
  ) then
    create trigger agent_location_stock_updated_at
      before update on public.agent_location_stock
      for each row execute procedure public.set_updated_at();
  end if;
end $$;
insert into public.agent_locations (org_id, agent_id, name, state, city, address, active, is_primary, notes)
select distinct
  a.org_id,
  a.id,
  case
    when coalesce(nullif(c.city, ''), '') <> '' then c.city || ', ' || c.state || ' Hub'
    else c.state || ' Hub'
  end,
  c.state,
  coalesce(c.city, ''),
  a.address,
  c.active,
  case
    when lower(coalesce(a.primary_base_state, a.zone, '')) = lower(c.state) and coalesce(c.city, '') = '' then true
    else false
  end,
  case
    when lower(coalesce(a.primary_base_state, a.zone, '')) = lower(c.state) then 'Auto-created from coverage'
    else 'Auto-created from coverage'
  end
from public.agents a
join public.agent_coverage c on c.agent_id = a.id
where not exists (
  select 1
  from public.agent_locations l
  where l.agent_id = a.id
    and lower(l.state) = lower(c.state)
    and lower(coalesce(l.city, '')) = lower(coalesce(c.city, ''))
);
insert into public.agent_locations (org_id, agent_id, name, state, city, address, active, is_primary, notes)
select
  a.org_id,
  a.id,
  coalesce(nullif(a.primary_base_state, ''), nullif(a.zone, ''), 'Unassigned') || ' Hub',
  coalesce(nullif(a.primary_base_state, ''), nullif(a.zone, ''), 'Unassigned'),
  '',
  a.address,
  true,
  true,
  'Primary hub'
from public.agents a
where not exists (
  select 1 from public.agent_locations l where l.agent_id = a.id
);
with ranked as (
  select
    l.id,
    l.agent_id,
    row_number() over (
      partition by l.agent_id
      order by
        case when lower(coalesce(a.primary_base_state, a.zone, '')) = lower(l.state) then 0 else 1 end,
        case when l.is_primary then 0 else 1 end,
        l.created_at,
        l.id
    ) as rn
  from public.agent_locations l
  join public.agents a on a.id = l.agent_id
)
update public.agent_locations l
set is_primary = (ranked.rn = 1)
from ranked
where ranked.id = l.id;
insert into public.agent_location_stock (org_id, agent_id, agent_location_id, product_id, quantity, defective, missing)
select
  a.org_id,
  s.agent_id,
  l.id,
  s.product_id,
  s.quantity,
  coalesce(s.defective, 0),
  coalesce(s.missing, 0)
from public.agent_stock s
join public.agents a on a.id = s.agent_id
join public.agent_locations l on l.agent_id = s.agent_id and l.is_primary = true
where not exists (
  select 1
  from public.agent_location_stock ls
  where ls.agent_location_id = l.id
    and ls.product_id = s.product_id
);
alter table public.orders
  add column if not exists agent_location_id uuid references public.agent_locations(id) on delete set null,
  add column if not exists agent_location_name_snapshot text,
  add column if not exists agent_location_state_snapshot text,
  add column if not exists agent_location_city_snapshot text;
update public.orders o
set
  agent_location_id = coalesce(
    o.agent_location_id,
    (
      select l.id
      from public.agent_locations l
      where l.agent_id = o.agent_id
      order by l.is_primary desc, l.created_at asc
      limit 1
    )
  ),
  agent_location_name_snapshot = coalesce(
    o.agent_location_name_snapshot,
    (
      select l.name
      from public.agent_locations l
      where l.id = coalesce(
        o.agent_location_id,
        (
          select l2.id
          from public.agent_locations l2
          where l2.agent_id = o.agent_id
          order by l2.is_primary desc, l2.created_at asc
          limit 1
        )
      )
    )
  ),
  agent_location_state_snapshot = coalesce(
    o.agent_location_state_snapshot,
    (
      select l.state
      from public.agent_locations l
      where l.id = coalesce(
        o.agent_location_id,
        (
          select l2.id
          from public.agent_locations l2
          where l2.agent_id = o.agent_id
          order by l2.is_primary desc, l2.created_at asc
          limit 1
        )
      )
    )
  ),
  agent_location_city_snapshot = coalesce(
    o.agent_location_city_snapshot,
    (
      select nullif(l.city, '')
      from public.agent_locations l
      where l.id = coalesce(
        o.agent_location_id,
        (
          select l2.id
          from public.agent_locations l2
          where l2.agent_id = o.agent_id
          order by l2.is_primary desc, l2.created_at asc
          limit 1
        )
      )
    )
  )
where o.agent_id is not null;
alter table public.stock_movements
  add column if not exists from_agent_location_id uuid references public.agent_locations(id) on delete set null,
  add column if not exists to_agent_location_id uuid references public.agent_locations(id) on delete set null;
alter table public.waybill_records
  add column if not exists from_agent_id uuid references public.agents(id) on delete set null,
  add column if not exists to_agent_id uuid references public.agents(id) on delete set null,
  add column if not exists from_agent_location_id uuid references public.agent_locations(id) on delete set null,
  add column if not exists to_agent_location_id uuid references public.agent_locations(id) on delete set null;
update public.waybill_records
set
  to_agent_id = coalesce(to_agent_id, agent_id),
  to_agent_location_id = coalesce(
    to_agent_location_id,
    (
      select l.id
      from public.agent_locations l
      where l.agent_id = coalesce(public.waybill_records.to_agent_id, public.waybill_records.agent_id)
      order by l.is_primary desc, l.created_at asc
      limit 1
    )
  )
where coalesce(agent_id, to_agent_id) is not null;
