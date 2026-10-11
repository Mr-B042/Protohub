-- Weekly report: the manager's change to a rep's final payout (Bright, 11 Oct 2026).
--
-- The system's bonus figure is not always right, so a Manager or Admin can add
-- to, or take off, a rep's final payout before the week goes to the Owner, with
-- a reason. The system's own figure is never overwritten: this row holds the
-- change beside it, so the Owner sees "system amount -> changed amount, who,
-- why" and approves or returns it.
--
-- One change per rep per week (one row per rep report). Once the Owner approves
-- and locks the week, system_amount + amount is the bonus on record for that
-- rep and week: payroll and the profit pages add `amount` to their own figure.
-- A reopened week stops counting until it is locked again.
--
-- Additive only: a new table, nothing existing is altered.

create table if not exists public.weekly_report_payout_changes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  week_start date not null,
  rep_report_id uuid not null references public.rep_weekly_reports(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete cascade,
  -- The rep's final bonus as the system worked it out (frozen on their report)
  -- at the moment of the change. Kept so the change is always read against the
  -- figure it was made on.
  system_amount numeric(14,2) not null check (system_amount >= 0),
  -- Added (+) or taken off (-). Never zero, never below what the rep is owed.
  amount numeric(14,2) not null check (amount <> 0 and system_amount + amount >= 0),
  reason text not null check (char_length(btrim(reason)) >= 3),
  changed_by uuid references public.users(id) on delete set null,
  changed_by_name text,
  changed_by_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists weekly_report_payout_changes_rep_report
  on public.weekly_report_payout_changes (rep_report_id);
create index if not exists weekly_report_payout_changes_branch_week
  on public.weekly_report_payout_changes (branch_id, week_start);
create index if not exists weekly_report_payout_changes_org_week
  on public.weekly_report_payout_changes (org_id, week_start);

-- The API uses the service role, which skips this. It exists so a direct
-- client can never read across orgs, and a rep only ever sees their own.
alter table public.weekly_report_payout_changes enable row level security;

drop policy if exists "weekly report payout changes select" on public.weekly_report_payout_changes;
create policy "weekly report payout changes select" on public.weekly_report_payout_changes
  for select to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );
