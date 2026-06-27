-- Follow-up KPI: mandatory daily follow-up logging with a per-order/per-day miss
-- penalty (Owner/Admin reviewed). Builds on the existing order_contact_attempts +
-- follow_up_tasks system.

-- 1. Multi-channel ticks per follow-up attempt: which of the four channels the rep
--    actually tried (Call / SMS / WhatsApp text / WhatsApp Beep). The legacy single
--    `channel` column stays as the primary channel for back-compat.
alter table public.order_contact_attempts
  add column if not exists channels text[] not null default '{}';

-- 2. Daily miss ledger. One row per order per WORKING day (Mon–Sat) that a required
--    follow-up wasn't done. Owner/Admin reviews each: approve -> materialise a ₦50
--    rep_penalties row (the existing payroll/bonus deduction path); waive -> no charge.
--    Sundays are never recorded. penalty_id is left FK-free on purpose because
--    rep_penalties is an externally-created table (its DDL isn't under migrations).
create table if not exists public.follow_up_misses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  order_id    text not null references public.orders(id) on delete cascade,
  rep_id      uuid references public.users(id) on delete set null,
  rep_name    text,
  miss_date   date not null,
  day_number  integer,
  reason      text not null default 'no_log',  -- 'no_log' | 'insufficient_calls'
  amount      numeric not null default 50,
  state       text not null default 'pending' check (state in ('pending','approved','waived')),
  penalty_id  uuid,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (order_id, miss_date)
);
create index if not exists idx_follow_up_misses_org_state
  on public.follow_up_misses (org_id, state, miss_date desc);
create index if not exists idx_follow_up_misses_rep
  on public.follow_up_misses (rep_id, miss_date desc);
