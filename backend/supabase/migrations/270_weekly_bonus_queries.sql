-- Bonus queries (Bright, 1 Oct 2026).
--
-- A rep who feels underpaid presses "Check My Bonus". The system checks the
-- week first (every delivered order paid, upsells/add-ons paid, no silent
-- hand changes, figures unchanged since submit, any order they name). If it
-- finds a problem the query goes to the manager; if it says "accurate" the
-- rep can still send it with a reason, marked so the manager knows.
--
-- A correction is NEVER written into a locked week. It is paid as an
-- adjustment on the week that is running when the manager resolves it
-- (correction_week_start), and shows on that week's report.
--
-- branch_id NOT NULL from the first row, so the table can sit in
-- BRANCH_TABLES (backend/src/lib/branch-scope.ts) at once.

create table if not exists public.weekly_bonus_queries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete cascade,
  -- The week the rep is asking about.
  week_start date not null,
  order_refs text[] not null default '{}',
  rep_message text,
  -- What the system check found when the rep asked: { verdict, findings[], checkedAt }.
  check_verdict text not null check (check_verdict in ('accurate', 'issues')),
  check_result jsonb not null default '{}'::jsonb,
  -- True when the check said accurate and the rep sent it anyway.
  sent_despite_accurate boolean not null default false,
  status text not null default 'open' check (status in ('open', 'corrected', 'no_change')),
  manager_response text,
  correction_amount numeric(12, 2) not null default 0 check (correction_amount >= 0),
  -- The week the correction is paid in (Sunday). Null until corrected.
  correction_week_start date,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_by_name text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'corrected' or (correction_amount > 0 and correction_week_start is not null))
);

create index if not exists weekly_bonus_queries_branch_status
  on public.weekly_bonus_queries (branch_id, status, created_at desc);
create index if not exists weekly_bonus_queries_rep
  on public.weekly_bonus_queries (rep_id, created_at desc);
create index if not exists weekly_bonus_queries_correction_week
  on public.weekly_bonus_queries (branch_id, correction_week_start)
  where status = 'corrected';

alter table public.weekly_bonus_queries enable row level security;

drop policy if exists "weekly bonus queries select" on public.weekly_bonus_queries;
create policy "weekly bonus queries select" on public.weekly_bonus_queries
  for select to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );
