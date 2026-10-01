-- Weekly Report approvals (Bright, 1 Oct 2026).
--
-- Replaces the WhatsApp weekly report. Protohub works out every figure; the
-- rep only reviews and submits. Then:
--   Rep submits -> Manager/Admin approves or returns -> every rep approved ->
--   Manager submits the company week -> Owner approves & locks, or returns.
--
-- Four tables:
--   rep_weekly_reports        one row per rep per week, with the FROZEN
--                             figures taken when the rep submitted
--   company_weekly_reports    one row per branch per week (manager -> owner)
--   weekly_report_corrections every "Return for Correction" and "Flag Issue",
--                             each tied to a section, a problem and a comment
--   weekly_report_audit       every action, timestamped. Rows can be added,
--                             never changed or deleted (trigger below).
--
-- ⚠️ BRANCH: every table carries branch_id NOT NULL from the first row, so all
-- four can sit in BRANCH_TABLES (backend/src/lib/branch-scope.ts) at once.
-- The routes write req.user.branchId; keys are per branch, never per org,
-- so Accra submitting a week can never touch Nigeria's row.

create table if not exists public.rep_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete cascade,
  week_start date not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'returned', 'manager_approved', 'owner_approved', 'locked')),
  -- The figures as the rep saw them when they pressed Submit. Never rewritten
  -- after that except by a resubmission; the review pages recompute live and
  -- flag any difference against this.
  snapshot jsonb,
  rep_note text,
  submit_count integer not null default 0,
  submitted_at timestamptz,
  manager_reviewed_by uuid references public.users(id) on delete set null,
  manager_reviewed_at timestamptz,
  owner_approved_by uuid references public.users(id) on delete set null,
  owner_approved_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists rep_weekly_reports_branch_rep_week
  on public.rep_weekly_reports (branch_id, rep_id, week_start);
create index if not exists rep_weekly_reports_branch_week
  on public.rep_weekly_reports (branch_id, week_start);

create table if not exists public.company_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  week_start date not null,
  status text not null default 'open'
    check (status in ('open', 'submitted_to_owner', 'returned_to_manager', 'locked')),
  manager_note text,
  owner_note text,
  -- Frozen when the manager submits to the owner.
  company_snapshot jsonb,
  manager_bonus_snapshot jsonb,
  submit_count integer not null default 0,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz,
  locked_by uuid references public.users(id) on delete set null,
  locked_at timestamptz,
  reopened_by uuid references public.users(id) on delete set null,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists company_weekly_reports_branch_week
  on public.company_weekly_reports (branch_id, week_start);

create table if not exists public.weekly_report_corrections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  week_start date not null,
  rep_report_id uuid references public.rep_weekly_reports(id) on delete cascade,
  company_report_id uuid references public.company_weekly_reports(id) on delete cascade,
  kind text not null check (kind in ('return', 'flag')),
  section text not null
    check (section in ('orders', 'delivery', 'product_breakdown', 'upsell_cross_sell', 'bonus', 'other')),
  problem text not null,
  comment text not null,
  order_ref text,
  raised_by uuid references public.users(id) on delete set null,
  raised_by_name text,
  raised_by_role text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  response text,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (rep_report_id is not null or company_report_id is not null)
);

create index if not exists weekly_report_corrections_branch_week
  on public.weekly_report_corrections (branch_id, week_start);
create index if not exists weekly_report_corrections_rep_report
  on public.weekly_report_corrections (rep_report_id);

create table if not exists public.weekly_report_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  week_start date not null,
  rep_report_id uuid references public.rep_weekly_reports(id) on delete set null,
  company_report_id uuid references public.company_weekly_reports(id) on delete set null,
  rep_id uuid references public.users(id) on delete set null,
  actor_id uuid references public.users(id) on delete set null,
  actor_name text,
  actor_role text,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists weekly_report_audit_branch_week
  on public.weekly_report_audit (branch_id, week_start, created_at);

-- Nobody quietly changes the record of what happened. The ON DELETE SET NULL
-- links above still have to work when a user or report row is removed, so
-- only those link columns may change; everything else is frozen.
create or replace function public.weekly_report_audit_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    -- Cascades from organizations/branches are the only deletes allowed.
    if exists (select 1 from public.branches b where b.id = old.branch_id) then
      raise exception 'weekly_report_audit rows cannot be deleted';
    end if;
    return old;
  end if;
  if new.org_id is distinct from old.org_id
     or new.branch_id is distinct from old.branch_id
     or new.week_start is distinct from old.week_start
     or new.actor_name is distinct from old.actor_name
     or new.actor_role is distinct from old.actor_role
     or new.action is distinct from old.action
     or new.detail is distinct from old.detail
     or new.created_at is distinct from old.created_at
     or (new.rep_report_id is not null and new.rep_report_id is distinct from old.rep_report_id)
     or (new.company_report_id is not null and new.company_report_id is distinct from old.company_report_id)
     or (new.rep_id is not null and new.rep_id is distinct from old.rep_id)
     or (new.actor_id is not null and new.actor_id is distinct from old.actor_id) then
    raise exception 'weekly_report_audit rows cannot be changed';
  end if;
  return new;
end $$;

drop trigger if exists trg_weekly_report_audit_append_only on public.weekly_report_audit;
create trigger trg_weekly_report_audit_append_only
  before update or delete on public.weekly_report_audit
  for each row execute function public.weekly_report_audit_append_only();

-- The API uses the service role, which skips these. They exist so a direct
-- client (or a future realtime subscription) can never read across orgs.
alter table public.rep_weekly_reports enable row level security;
alter table public.company_weekly_reports enable row level security;
alter table public.weekly_report_corrections enable row level security;
alter table public.weekly_report_audit enable row level security;

drop policy if exists "rep weekly reports select" on public.rep_weekly_reports;
create policy "rep weekly reports select" on public.rep_weekly_reports
  for select to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );

drop policy if exists "company weekly reports select" on public.company_weekly_reports;
create policy "company weekly reports select" on public.company_weekly_reports
  for select to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'));

drop policy if exists "weekly report corrections select" on public.weekly_report_corrections;
create policy "weekly report corrections select" on public.weekly_report_corrections
  for select to authenticated
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
      or exists (select 1 from public.rep_weekly_reports r where r.id = rep_report_id and r.rep_id = auth.uid())
    )
  );

drop policy if exists "weekly report audit select" on public.weekly_report_audit;
create policy "weekly report audit select" on public.weekly_report_audit
  for select to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );
