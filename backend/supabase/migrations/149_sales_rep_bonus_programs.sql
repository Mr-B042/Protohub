-- Sales Rep Bonus Programs + weekly rule engine source tables.
-- The product.bonus_config JSON remains historical/legacy; these tables are
-- the owner/admin managed source of truth for future bonus payroll.

alter table public.orders
  add column if not exists full_upfront_paid boolean not null default false,
  add column if not exists full_upfront_paid_at timestamptz,
  add column if not exists full_upfront_marked_by uuid references public.users(id) on delete set null;

create table if not exists public.sales_bonus_programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'deleted')),
  recurrence text not null default 'weekly' check (recurrence in ('weekly')),
  timezone text not null default 'Africa/Lagos',
  week_start_day integer not null default 0 check (week_start_day between 0 and 6),
  starts_on date not null default current_date,
  ends_on date,
  applies_to_user_ids uuid[] not null default '{}',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.sales_bonus_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  program_id uuid not null references public.sales_bonus_programs(id) on delete cascade,
  name text not null,
  type text not null check (type in ('upgrade_count', 'cross_sell_count', 'upfront_percent', 'delivery_rate_per_delivered')),
  status text not null default 'active' check (status in ('active', 'paused', 'deleted')),
  config jsonb not null default '{}'::jsonb,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_sales_bonus_programs_org_status
  on public.sales_bonus_programs(org_id, status, starts_on desc);

create index if not exists idx_sales_bonus_rules_org_program_order
  on public.sales_bonus_rules(org_id, program_id, display_order, created_at);

create index if not exists idx_orders_full_upfront_paid
  on public.orders(org_id, full_upfront_paid, status, assigned_rep_id)
  where full_upfront_paid is true;

alter table public.sales_bonus_programs enable row level security;
alter table public.sales_bonus_rules enable row level security;

drop policy if exists "sales bonus programs select org members" on public.sales_bonus_programs;
drop policy if exists "sales bonus programs insert owner admin manager" on public.sales_bonus_programs;
drop policy if exists "sales bonus programs update owner admin manager" on public.sales_bonus_programs;
drop policy if exists "sales bonus programs delete owner admin manager" on public.sales_bonus_programs;

create policy "sales bonus programs select org members"
  on public.sales_bonus_programs
  for select
  to authenticated
  using (org_id = private.auth_org_id());

create policy "sales bonus programs insert owner admin manager"
  on public.sales_bonus_programs
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

create policy "sales bonus programs update owner admin manager"
  on public.sales_bonus_programs
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

create policy "sales bonus programs delete owner admin manager"
  on public.sales_bonus_programs
  for delete
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

drop policy if exists "sales bonus rules select org members" on public.sales_bonus_rules;
drop policy if exists "sales bonus rules insert owner admin manager" on public.sales_bonus_rules;
drop policy if exists "sales bonus rules update owner admin manager" on public.sales_bonus_rules;
drop policy if exists "sales bonus rules delete owner admin manager" on public.sales_bonus_rules;

create policy "sales bonus rules select org members"
  on public.sales_bonus_rules
  for select
  to authenticated
  using (org_id = private.auth_org_id());

create policy "sales bonus rules insert owner admin manager"
  on public.sales_bonus_rules
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

create policy "sales bonus rules update owner admin manager"
  on public.sales_bonus_rules
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

create policy "sales bonus rules delete owner admin manager"
  on public.sales_bonus_rules
  for delete
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

with created_programs as (
  insert into public.sales_bonus_programs (
    org_id,
    name,
    description,
    status,
    starts_on
  )
  select
    o.id,
    'Weekly Sales Rep Bonus',
    'Flexible weekly bonus board for sales reps: upgrades, cross-sells, upfront payments, and delivery-rate pay.',
    'active',
    current_date
  from public.organizations o
  where not exists (
    select 1
    from public.sales_bonus_programs p
    where p.org_id = o.id
      and p.name = 'Weekly Sales Rep Bonus'
      and p.status <> 'deleted'
  )
  returning id, org_id
)
insert into public.sales_bonus_rules (org_id, program_id, name, type, config, display_order)
select org_id, id, 'Upgrade 5 customers', 'upgrade_count',
  '{"fromQty":3,"toQtyMin":4,"targetCount":5,"amount":2000,"repeatMode":"once_per_week"}'::jsonb, 10
from created_programs
union all
select org_id, id, 'Cross-sell 2 customers', 'cross_sell_count',
  '{"targetCount":2,"amount":4000,"repeatMode":"once_per_week","repDrivenOnly":true}'::jsonb, 20
from created_programs
union all
select org_id, id, 'Full upfront payment commission', 'upfront_percent',
  '{"percent":5,"requiresDelivered":true}'::jsonb, 30
from created_programs
union all
select org_id, id, 'Delivery-rate pay boost', 'delivery_rate_per_delivered',
  '{"minOrders":50,"targetRatePercent":70,"fallbackPerDelivered":200,"qualifiedPerDelivered":400}'::jsonb, 40
from created_programs;
