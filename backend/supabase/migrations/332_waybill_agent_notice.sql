-- Waybill Follow-Up: tell the agent's group within the hour (Bright, 7 Nov 2026).
--
-- The day a waybill is made, the logistics manager ticks "I've informed the
-- agent's group" within 60 minutes of creating it (8:00 AM the next working
-- day when it is made after 5 PM, before 8 AM or on a day off). A notice not
-- ticked in time costs ₦500 per waybill, charged like a missed follow-up
-- session (Missed Logs & Charges, disputes, payroll). The five daily
-- follow-up sessions then start the next working day.

create table if not exists public.waybill_agent_notices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete restrict,
  waybill_id text not null,
  informed_at timestamptz not null default now(),
  informed_by uuid references public.users(id) on delete set null,
  informed_by_name text not null default '',
  created_at timestamptz not null default now(),
  unique (org_id, waybill_id)
);
create index if not exists waybill_agent_notices_org_time on public.waybill_agent_notices (org_id, informed_at desc);
alter table public.waybill_agent_notices enable row level security;

-- A tick is a record of what she did and when: never changed afterwards.
create or replace function public.waybill_agent_notices_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.organizations o where o.id = old.org_id) then
      raise exception 'waybill_agent_notices rows cannot be deleted';
    end if;
    return old;
  end if;
  if new.informed_at is distinct from old.informed_at or new.waybill_id is distinct from old.waybill_id
     or new.org_id is distinct from old.org_id or new.informed_by_name is distinct from old.informed_by_name then
    raise exception 'waybill_agent_notices rows cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists waybill_agent_notices_append_only on public.waybill_agent_notices;
create trigger waybill_agent_notices_append_only before update or delete on public.waybill_agent_notices
  for each row execute function public.waybill_agent_notices_append_only();

-- A late notice is recorded and charged as a miss of its own kind.
alter table public.waybill_follow_up_misses drop constraint if exists waybill_follow_up_misses_session_key_check;
alter table public.waybill_follow_up_misses add constraint waybill_follow_up_misses_session_key_check
  check (session_key in ('m1', 'm2', 'a1', 'a2', 'ev', 'notice'));

alter table public.waybill_follow_up_settings add column if not exists notice_minutes integer not null default 60
  check (notice_minutes between 15 and 240);
alter table public.waybill_follow_up_settings add column if not exists notice_amount numeric not null default 500
  check (notice_amount >= 0);
