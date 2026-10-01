-- Head of Sales weekly script, script use on orders, and bonus release
-- (Bright, 1 Oct 2026). Additive only.
--
-- Before the Head of Sales bonus is released Bright wants to see whether she
-- actually made the team better: was an upsell & cross-sell script submitted
-- for the week, did the reps use it, and which reps improved because of it
-- versus on their own.
--
-- sales_scripts            one script per branch per week, written by the head
-- order_script_uses        the rep's "I used this week's script" tick, one per order
-- head_of_sales_bonus_releases  the Owner's release / withhold decision. If she
--   reaches a bonus level but no script was submitted, or nobody used it, the
--   bonus is held until the Owner decides. Only a released bonus can be paid.

create table if not exists public.sales_scripts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  head_of_sales_rep_id uuid not null references public.users(id) on delete cascade,
  week_start date not null,
  upsell_script text not null default '',
  cross_sell_script text not null default '',
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_scripts_branch_week on public.sales_scripts (org_id, branch_id, week_start);

create table if not exists public.order_script_uses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  order_id text not null,
  rep_id uuid not null references public.users(id) on delete cascade,
  script_id uuid not null references public.sales_scripts(id) on delete cascade,
  week_start date not null,
  created_at timestamptz not null default now()
);

create unique index if not exists order_script_uses_order on public.order_script_uses (org_id, order_id);
create index if not exists order_script_uses_week on public.order_script_uses (branch_id, week_start, rep_id);

create table if not exists public.head_of_sales_bonus_releases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  head_of_sales_rep_id uuid not null references public.users(id) on delete cascade,
  week_start date not null,
  decision text not null check (decision in ('released', 'withheld')),
  was_held boolean not null default false,
  hold_reasons jsonb not null default '[]'::jsonb,
  bonus_level text not null default 'none',
  amount numeric(12, 2) not null default 0,
  note text,
  decided_by uuid references public.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz not null default now()
);

create unique index if not exists head_of_sales_bonus_releases_week
  on public.head_of_sales_bonus_releases (org_id, head_of_sales_rep_id, week_start);

alter table public.sales_scripts enable row level security;
alter table public.order_script_uses enable row level security;
alter table public.head_of_sales_bonus_releases enable row level security;

-- Every rep reads the week's script - they are meant to use it.
create policy "sales scripts select org" on public.sales_scripts
  for select to authenticated
  using (org_id = private.auth_org_id());

create policy "order script uses select" on public.order_script_uses
  for select to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );

create policy "head of sales bonus releases select" on public.head_of_sales_bonus_releases
  for select to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or head_of_sales_rep_id = auth.uid())
  );
