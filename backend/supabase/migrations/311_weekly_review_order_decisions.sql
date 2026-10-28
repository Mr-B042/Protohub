-- Weekly review: a decision on every flagged order (Bright, 28 Oct 2026).
--
-- The weekly review lists two kinds of order against a rep:
--   missing_fee  - delivered with no delivery fee
--   late_send    - not sent out of New within 15 working minutes
-- Leadership must decide on EACH order before the rep's report can be
-- approved: charge it (an amount they type) or skip it (a reason is required).
--
-- A charge is also saved as an ordinary rep_penalties row (penalty_id), so the
-- rep sees it in their fines and payroll takes it off. A skip is never shown
-- to the rep. One decision per order per kind; undoing deletes the row (and
-- its fine).
--
-- Additive only: a new table, nothing existing is altered.

create table if not exists public.weekly_review_order_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  week_start date not null,
  rep_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('missing_fee', 'late_send')),
  order_id text not null,
  decision text not null check (decision in ('charged', 'skipped')),
  amount numeric(12,2),
  reason text,
  penalty_id uuid references public.rep_penalties(id) on delete set null,
  decided_by uuid references public.users(id) on delete set null,
  decided_by_name text,
  decided_by_role text,
  created_at timestamptz not null default now(),
  check (
    (decision = 'charged' and amount > 0)
    or (decision = 'skipped' and char_length(btrim(coalesce(reason, ''))) >= 3)
  )
);

create unique index if not exists weekly_review_order_decisions_once
  on public.weekly_review_order_decisions (org_id, kind, order_id);
create index if not exists weekly_review_order_decisions_branch_week
  on public.weekly_review_order_decisions (branch_id, week_start);
create index if not exists weekly_review_order_decisions_rep_week
  on public.weekly_review_order_decisions (org_id, rep_id, week_start);

-- The API uses the service role, which skips this. Leadership only: a rep
-- sees charges through their fines, never the skips.
alter table public.weekly_review_order_decisions enable row level security;

drop policy if exists "weekly review order decisions select" on public.weekly_review_order_decisions;
create policy "weekly review order decisions select" on public.weekly_review_order_decisions
  for select to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager')
  );
