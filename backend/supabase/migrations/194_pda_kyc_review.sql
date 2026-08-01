-- 194: what the KYC Review and Guarantor Verification screens need.
--
-- The guarantor record was built for "who are they and are they verified".
-- Actually WORKING a verification needs more: how to reach them, when they
-- prefer to be called, how many times we have tried, and who owns the task.
alter table public.pda_guarantors
  add column if not exists email text,
  add column if not exists workplace text,
  add column if not exists years_known text,
  -- The referee's own words on how they know the applicant. This is the whole
  -- point of a guarantor, so it is a first-class field rather than a note.
  add column if not exists reference_statement text,
  add column if not exists preferred_contact_time text,
  add column if not exists call_attempts integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists assigned_to uuid,
  add column if not exists assigned_to_name text;

comment on column public.pda_guarantors.call_attempts is
  'How many times we have actually tried to reach them. "Unable to verify" after 0 attempts is a different fact from after 5.';

-- ── Notes on an application or a guarantor ───────────────
-- Internal only. Never shown to the applicant, so a reviewer can record a
-- doubt without it becoming an accusation on the record.
create table if not exists public.pda_notes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null,
  agent_id     uuid references public.personal_delivery_agents(id) on delete cascade,
  guarantor_id uuid references public.pda_guarantors(id) on delete cascade,
  body         text not null,
  author_id    uuid,
  author_name  text,
  created_at   timestamptz not null default now(),
  -- A note must be about something.
  constraint pda_note_has_subject check (agent_id is not null or guarantor_id is not null)
);

create index if not exists idx_pda_notes_agent on public.pda_notes (agent_id, created_at desc);
create index if not exists idx_pda_notes_guarantor on public.pda_notes (guarantor_id, created_at desc);

alter table public.pda_notes enable row level security;
