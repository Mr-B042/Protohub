-- Log-miss disputes (Bright, 1 Oct 2026). Additive only.
--
-- Missed follow-up logs (N50 per order per day, follow_up_misses) and missed
-- cart logs (N500 per cart per day, derived live; cart_log_misses holds the
-- Owner's decision) now show on the rep's weekly report, deducted only once
-- the Owner has approved them (Bright kept "Owner approves first").
--
-- A rep who thinks a miss is wrong asks the system to check it. The check
-- shows what they actually logged that day. If it finds the miss was wrong,
-- the dispute goes to the manager marked so; if it confirms the miss, the rep
-- can still escalate with a reason. The manager cancels or keeps it. A miss
-- the Owner already approved can only be cancelled by the Owner.
--
-- miss_ref: follow_up_misses.id for a follow-up miss; "<rep_id>|<miss_date>"
-- for a cart-log day (cart misses have no row until the Owner decides).

create table if not exists public.log_miss_disputes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  rep_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('follow_up', 'cart_log')),
  miss_ref text not null,
  miss_date date not null,
  amount numeric(12, 2) not null default 0,
  order_id text,
  -- What the system check found: { verdict, findings[], checkedAt }.
  check_verdict text not null check (check_verdict in ('miss_confirmed', 'miss_wrong')),
  check_result jsonb not null default '{}'::jsonb,
  rep_reason text,
  status text not null default 'open' check (status in ('open', 'cancelled', 'kept', 'awaiting_owner')),
  decided_by uuid references public.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists log_miss_disputes_branch_status on public.log_miss_disputes (branch_id, status, created_at desc);
create index if not exists log_miss_disputes_rep on public.log_miss_disputes (rep_id, miss_date);
-- One live dispute per miss.
create unique index if not exists log_miss_disputes_one_open
  on public.log_miss_disputes (miss_ref) where status in ('open', 'awaiting_owner');

alter table public.log_miss_disputes enable row level security;

create policy "log miss disputes select" on public.log_miss_disputes
  for select to authenticated
  using (
    org_id = private.auth_org_id()
    and (private.auth_user_role()::text in ('Owner', 'Admin', 'Manager') or rep_id = auth.uid())
  );
