-- Weekly Report (Head of Sales Rep, Stage 9): a narrative report she writes
-- herself each Sunday-anchored week, plus a FROZEN snapshot of that week's
-- scorecard + initiative numbers taken at save/submit time - so editing an
-- order or an initiative later can never retroactively rewrite a week that
-- was already reported on.
--
-- Scoped by (org_id, head_of_sales_rep_id, week_start) rather than just
-- (org_id, week_start) - every other page in this feature is scoped to a
-- specific Head of Sales Rep's dashboard (repId), and this stays consistent
-- with that even though today only one such rep typically exists per org.

create table if not exists public.head_of_sales_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  head_of_sales_rep_id uuid not null references public.users(id) on delete cascade,
  week_start date not null,
  summary_wins text,
  summary_challenges text,
  next_week_plan text,
  performance_snapshot jsonb,
  submitted_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists head_of_sales_weekly_reports_org_rep_week
  on public.head_of_sales_weekly_reports (org_id, head_of_sales_rep_id, week_start);

alter table public.head_of_sales_weekly_reports enable row level security;

drop policy if exists "head of sales weekly reports select leadership or self" on public.head_of_sales_weekly_reports;
drop policy if exists "head of sales weekly reports write leadership or self" on public.head_of_sales_weekly_reports;

create policy "head of sales weekly reports select leadership or self"
  on public.head_of_sales_weekly_reports
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or head_of_sales_rep_id = auth.uid())
  );

create policy "head of sales weekly reports write leadership or self"
  on public.head_of_sales_weekly_reports
  for all
  to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or head_of_sales_rep_id = auth.uid())
  )
  with check (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or head_of_sales_rep_id = auth.uid())
  );
