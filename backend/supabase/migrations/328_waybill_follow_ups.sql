-- Waybill Follow-Up Center (Bright, 7 Nov 2026).
-- Every waybill still In Transit is followed up five times a working day
-- (8:00, 10:00, 12:00, 2:00 and 4-5 PM) until the agent's receipt is
-- confirmed (the waybill is marked Received). Each waybill not followed up
-- in a session costs the person responsible ₦500, charged automatically
-- (Bright: "₦500 per waybill per session", "approve automatically").

-- 1) The exact time a waybill left In Transit (received, returned, cancelled
--    ...): a session after that time is not owed. Additive: nothing that reads
--    or writes waybills changes.
alter table public.waybill_records add column if not exists closed_at timestamptz;

create or replace function public.waybill_mark_closed()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'In Transit' and new.status <> 'In Transit' then
      new.closed_at := coalesce(new.closed_at, now());
    elsif new.status = 'In Transit' then
      new.closed_at := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists waybill_mark_closed on public.waybill_records;
create trigger waybill_mark_closed
  before update of status on public.waybill_records
  for each row execute function public.waybill_mark_closed();

-- 2) Each follow-up logged. Never edited or deleted: a correction is a new entry.
create table if not exists public.waybill_follow_up_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete restrict,
  waybill_id text not null,
  -- One call or WhatsApp message that covered several waybills.
  batch_id uuid,
  -- Lagos day and session it counts for (m1 m2 a1 a2 ev); null = outside every session window.
  session_date date not null,
  session_key text check (session_key in ('m1', 'm2', 'a1', 'a2', 'ev')),
  channels text[] not null check (cardinality(channels) > 0),
  response text not null,
  response_note text not null default '' check (char_length(response_note) <= 1000),
  next_action text not null default '' check (char_length(next_action) <= 300),
  evidence_path text,
  logged_by uuid references public.users(id) on delete set null,
  logged_by_name text not null default '',
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists waybill_follow_up_logs_day_idx on public.waybill_follow_up_logs (org_id, session_date);
create index if not exists waybill_follow_up_logs_waybill_idx on public.waybill_follow_up_logs (waybill_id, logged_at desc);

-- 3) A waybill not followed up in a session: one row each, charged automatically.
create table if not exists public.waybill_follow_up_misses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete restrict,
  waybill_id text not null,
  session_date date not null,
  session_key text not null check (session_key in ('m1', 'm2', 'a1', 'a2', 'ev')),
  responsible_user_id uuid references public.users(id) on delete set null,
  responsible_name text not null default '',
  amount numeric not null default 500 check (amount >= 0),
  -- charged: fine row written; disputed: the person disputes it (still charged
  -- until decided); cancelled: Owner cancelled it (fine removed); not_charged:
  -- nobody set as responsible when it was missed.
  state text not null default 'charged' check (state in ('charged', 'disputed', 'cancelled', 'not_charged')),
  penalty_id uuid,
  dispute_reason text,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  unique (waybill_id, session_date, session_key)
);
create index if not exists waybill_follow_up_misses_day_idx on public.waybill_follow_up_misses (org_id, session_date);

-- 4) Settings (one row per organisation).
create table if not exists public.waybill_follow_up_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  -- Who answers for the follow-ups (null = the active Inventory & Logistics user, if exactly one).
  responsible_user_id uuid references public.users(id) on delete set null,
  amount numeric not null default 500 check (amount >= 0),
  grace_minutes integer not null default 15 check (grace_minutes between 0 and 45),
  -- 0 = Sunday ... 6 = Saturday.
  working_days integer[] not null default '{1,2,3,4,5,6}',
  -- No session before this day is ever charged.
  charges_from date not null default '2026-11-09',
  -- In transit longer than this: "Overdue".
  overdue_after_days integer not null default 3 check (overdue_after_days between 1 and 30),
  updated_by_name text,
  updated_at timestamptz not null default now()
);

alter table public.waybill_follow_up_logs enable row level security;
alter table public.waybill_follow_up_misses enable row level security;
alter table public.waybill_follow_up_settings enable row level security;

-- Screenshots of the call or WhatsApp message (optional), private.
insert into storage.buckets (id, name, public, file_size_limit)
values ('waybill-follow-up-evidence', 'waybill-follow-up-evidence', false, 10485760)
on conflict (id) do nothing;
