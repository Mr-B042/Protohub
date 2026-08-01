-- 201: shareable public links for agent self-application.
--
-- A prospective agent fills in their own details and waits for approval,
-- instead of someone in the office typing it all in from a WhatsApp thread.
--
-- The link carries a random token rather than exposing the org id, and is
-- revocable and optionally expiring, because a link that gets forwarded around
-- WhatsApp cannot be un-forwarded - only switched off.
create table if not exists public.pda_application_links (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  token          text not null unique,
  label          text,
  active         boolean not null default true,
  expires_at     timestamptz,
  -- A cap turns an abused link into a bounded problem rather than an open tap.
  max_submissions integer,
  submission_count integer not null default 0,
  created_by     uuid,
  created_by_name text,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoked_by     uuid
);

create index if not exists idx_pda_app_links_token on public.pda_application_links (token) where active;
create index if not exists idx_pda_app_links_org on public.pda_application_links (org_id, created_at desc);

-- Where a self-submitted application came from, so a suspicious burst can be
-- traced back to the link that let it in.
alter table public.personal_delivery_agents
  add column if not exists application_link_id uuid,
  add column if not exists submitted_via text;

comment on column public.personal_delivery_agents.submitted_via is
  'How the application arrived: "Internal entry" or "Public link" (migration 201).';

alter table public.pda_application_links enable row level security;
