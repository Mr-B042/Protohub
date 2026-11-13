-- Social Leads: Direct Meta (free) — Protohub talks to Facebook & Instagram
-- itself, no ManyChat needed (Bright, 13 Nov 2026; approach borrowed from
-- OpenReply, MIT). One switch per branch decides who delivers messages, so
-- moving to ManyChat later never sends a customer two replies.

create table if not exists public.social_lead_meta (
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  -- true = Direct Meta delivers messages and its events are used; false = ignored (ManyChat or nothing).
  active boolean not null default false,
  app_id text,
  -- App secret and Page keys are AES-256-GCM encrypted by the server (lib/secret-box.ts).
  app_secret_enc text,
  verify_token text not null default replace(gen_random_uuid()::text, '-', ''),
  -- When someone comments: private message (+ optional public reply). See meta-direct-rules.ts cleanCommentReply.
  comment_reply jsonb not null default '{}'::jsonb,
  last_event_at timestamptz,
  last_error text,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, branch_id)
);

create table if not exists public.social_lead_meta_pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  page_id text not null unique,
  page_name text not null default '',
  page_token_enc text not null,
  ig_id text unique,
  ig_username text,
  subscribed boolean not null default false,
  subscribe_error text,
  connected_by uuid references public.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_event_at timestamptz
);
create index if not exists social_lead_meta_pages_branch on public.social_lead_meta_pages (org_id, branch_id);

alter table public.social_leads add column if not exists channel text not null default 'manychat';
alter table public.social_leads drop constraint if exists social_leads_channel_check;
alter table public.social_leads add constraint social_leads_channel_check check (channel in ('manychat', 'meta', 'manual'));
-- Which Page / Instagram account the Direct Meta chat runs through.
alter table public.social_leads add column if not exists meta_page_id text;
-- The latest comment not yet answered privately: Meta allows ONE private reply per comment, within 7 days.
alter table public.social_leads add column if not exists pending_comment_id text;
alter table public.social_leads add column if not exists pending_comment_at timestamptz;
-- The id Meta gave the person on their COMMENT (it differs from their chat id): later comments find the same lead.
alter table public.social_leads add column if not exists meta_alt_id text;
create index if not exists social_leads_meta_alt_id on public.social_leads (org_id, meta_alt_id) where meta_alt_id is not null;
-- Instagram account id (from ManyChat's contact data or Meta) so a switch between the two keeps the same lead.
alter table public.social_leads add column if not exists ig_id text;
create index if not exists social_leads_ig_id on public.social_leads (org_id, ig_id) where ig_id is not null;

update public.social_leads set channel = 'manual' where manychat_contact_id like 'manual-%' and channel = 'manychat';

alter table public.social_lead_meta enable row level security;
alter table public.social_lead_meta_pages enable row level security;
