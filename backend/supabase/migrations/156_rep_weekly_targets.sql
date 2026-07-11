-- Weekly per-sales-rep upselling/cross-selling targets, set by Owner/Admin/
-- Manager so the manager has a real coaching tool (not just a bonus payout
-- number) - target % per rep per week, compared against that rep's own
-- Delivered Sales Expansion Rate for the same week on the frontend.

create table if not exists public.rep_weekly_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete cascade,
  week_start date not null,
  target_pct numeric(5,2) not null default 0,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rep_weekly_targets_target_pct_range check (target_pct >= 0 and target_pct <= 100),
  constraint rep_weekly_targets_unique_rep_week unique (org_id, rep_id, week_start)
);

create index if not exists rep_weekly_targets_org_week_idx on public.rep_weekly_targets (org_id, week_start);

alter table public.rep_weekly_targets enable row level security;

drop policy if exists "rep weekly targets select org managers" on public.rep_weekly_targets;
drop policy if exists "rep weekly targets write org managers" on public.rep_weekly_targets;
drop policy if exists "rep weekly targets update org managers" on public.rep_weekly_targets;
drop policy if exists "rep weekly targets delete org managers" on public.rep_weekly_targets;

create policy "rep weekly targets select org managers"
  on public.rep_weekly_targets
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

create policy "rep weekly targets write org managers"
  on public.rep_weekly_targets
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );

create policy "rep weekly targets update org managers"
  on public.rep_weekly_targets
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

create policy "rep weekly targets delete org managers"
  on public.rep_weekly_targets
  for delete
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );
