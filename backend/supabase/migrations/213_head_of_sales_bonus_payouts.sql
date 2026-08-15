-- Bonus & Payouts (Head of Sales Rep, Stage 10): Owner-editable tier
-- settings shared by every page that previews a bonus (Overview, Weekly
-- Scorecard, this page), plus a persisted Pending/Paid record per rep per
-- week - mirrors payroll_runs' shape rather than manager-bonus.ts's
-- live-only evaluate(), because a bonus that was actually paid must stay a
-- fixed historical fact even if settings or orders change later.

create table if not exists public.head_of_sales_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  currency text not null default 'NGN',
  tiers jsonb not null default '[
    {"id": "level1", "label": "Level 1 - Meets Standard", "amount": 5000, "minTeamAov": 19500, "minDeliveryRate": 60},
    {"id": "level2", "label": "Level 2 - Strong Performance", "amount": 10000, "minTeamAov": 21000, "minDeliveryRate": 60, "requiresUpsellImprovement": true},
    {"id": "level3", "label": "Level 3 - Excellent Performance", "amount": 15000, "minTeamAov": 23000, "minDeliveryRate": 65, "requiresInitiativeSuccess": true}
  ]'::jsonb,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists head_of_sales_settings_org_unique on public.head_of_sales_settings (org_id);

create table if not exists public.head_of_sales_bonus_weekly_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  head_of_sales_rep_id uuid not null references public.users(id) on delete cascade,
  week_start date not null,
  team_aov numeric(12, 2) not null default 0,
  team_delivery_rate numeric(5, 2) not null default 0,
  upsell_improvement boolean not null default false,
  initiative_success boolean not null default false,
  bonus_level text not null default 'none' check (bonus_level in ('none', 'level1', 'level2', 'level3')),
  amount numeric(12, 2) not null default 0,
  status text not null default 'Pending' check (status in ('Pending', 'Paid')),
  notes text,
  paid_at timestamptz,
  paid_by uuid references public.users(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists head_of_sales_bonus_weekly_records_org_rep_week
  on public.head_of_sales_bonus_weekly_records (org_id, head_of_sales_rep_id, week_start);

alter table public.head_of_sales_settings enable row level security;
alter table public.head_of_sales_bonus_weekly_records enable row level security;

drop policy if exists "head of sales settings select leadership or self" on public.head_of_sales_settings;
drop policy if exists "head of sales settings write owner" on public.head_of_sales_settings;

-- Every rep can SEE the tier thresholds she's being measured against - only
-- the Owner can change what those thresholds are.
create policy "head of sales settings select leadership or self"
  on public.head_of_sales_settings
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_head_of_sales_rep)
    )
  );

create policy "head of sales settings write owner"
  on public.head_of_sales_settings
  for all
  to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner')
  with check (org_id = private.auth_org_id() and private.auth_user_role()::text = 'Owner');

drop policy if exists "head of sales bonus records select leadership or self" on public.head_of_sales_bonus_weekly_records;
drop policy if exists "head of sales bonus records write leadership" on public.head_of_sales_bonus_weekly_records;

-- Read: leadership, or the rep viewing her own pay history. Write: leadership
-- ONLY - unlike Stage 8's initiatives, this is her own compensation being
-- evaluated, so it is never self-certified.
create policy "head of sales bonus records select leadership or self"
  on public.head_of_sales_bonus_weekly_records
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or head_of_sales_rep_id = auth.uid())
  );

create policy "head of sales bonus records write leadership"
  on public.head_of_sales_bonus_weekly_records
  for all
  to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'))
  with check (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'));
