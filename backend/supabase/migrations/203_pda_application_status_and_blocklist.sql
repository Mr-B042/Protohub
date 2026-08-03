-- 203: applicant status link + applicant blocklist.
--
-- A private per-application token so an applicant can come back and see where
-- they stand, and add what is still missing.
--
-- Not a login: an applicant is not a user. They only become one when a manager
-- approves them and grants access, which is the whole point of the review. A
-- password here would mean real accounts for unapproved strangers, plus resets
-- to support, in exchange for nothing the token does not already give.
alter table public.personal_delivery_agents
  add column if not exists status_token text,
  add column if not exists status_reason text,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_by uuid;

create unique index if not exists idx_pda_status_token
  on public.personal_delivery_agents (status_token)
  where status_token is not null;

comment on column public.personal_delivery_agents.status_token is
  'Private token for the applicant''s own status page. Public link, no login (migration 203).';
comment on column public.personal_delivery_agents.status_reason is
  'Why an application was rejected or restricted, shown to the applicant (migration 203).';

-- Phone numbers refused entry, checked on EVERY link rather than per link.
-- A link that leaked cannot be un-forwarded, so blocking has to follow the
-- person: revoking the one link they used just sends them to the next one.
create table if not exists public.pda_blocked_applicants (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  -- Digits only, so 0803... and +23480... are the same person.
  phone_digits   text not null,
  display_phone  text,
  full_name      text,
  reason         text not null,
  agent_id       uuid,
  application_link_id uuid,
  blocked_by     uuid,
  blocked_by_name text,
  created_at     timestamptz not null default now(),
  constraint pda_blocked_phone_unique unique (org_id, phone_digits)
);

create index if not exists idx_pda_blocked_org
  on public.pda_blocked_applicants (org_id, created_at desc);

alter table public.pda_blocked_applicants enable row level security;
