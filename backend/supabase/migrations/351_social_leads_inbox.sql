-- Social Leads Inbox (Bright, 12 Nov 2026): Facebook / Instagram comments and
-- messages through ManyChat become leads, handed to call reps (cart hand-out
-- rules, sticky per customer), worked in a three-panel inbox and converted to
-- orders. One ManyChat connection per branch.

create table if not exists public.social_lead_settings (
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  -- ManyChat API key (Settings › API in ManyChat). Never sent to the browser.
  manychat_api_key text,
  manychat_page_name text,
  manychat_page_id text,
  connected_at timestamptz,
  connection_error text,
  -- The secret part of the address ManyChat posts to.
  webhook_secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  facebook_connected boolean not null default false,
  instagram_connected boolean not null default false,
  auto_assign boolean not null default true,
  telegram_alerts boolean not null default true,
  -- Minutes since an unanswered customer message: yellow, red, nudge the rep, tell managers, hand to another rep.
  sla jsonb not null default '{"yellow": 2, "red": 5, "renotify": 10, "escalate": 15, "reassign": 20}'::jsonb,
  max_open_per_rep integer not null default 0,
  last_event_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (org_id, branch_id),
  unique (webhook_secret)
);

create sequence if not exists public.social_lead_ref_seq;

create table if not exists public.social_leads (
  id uuid primary key default gen_random_uuid(),
  ref text not null default ('SL-' || lpad(nextval('public.social_lead_ref_seq')::text, 4, '0')),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  manychat_contact_id text not null,
  platform text not null default 'facebook' check (platform in ('facebook', 'instagram', 'messenger')),
  name text not null default '',
  profile_pic text,
  instagram_username text,
  phone text,
  whatsapp text,
  email text,
  state text,
  address text,
  product_id uuid references public.products(id) on delete set null,
  product_interest text,
  package_id uuid,
  offer_text text,
  source_label text,
  campaign_name text,
  campaign_id text,
  ad_id text,
  ad_name text,
  original_comment text,
  status text not null default 'new' check (status in (
    'comment_captured', 'dm_sent', 'engaged', 'new', 'in_conversation', 'hot', 'call_requested',
    'awaiting_customer', 'follow_up', 'order_created', 'delivered', 'lost')),
  hot boolean not null default false,
  lead_score integer not null default 0,
  assigned_to uuid references public.users(id) on delete set null,
  assigned_at timestamptz,
  assigned_by text,
  first_customer_message_at timestamptz,
  last_customer_message_at timestamptz,
  last_rep_message_at timestamptz,
  first_response_at timestamptz,
  first_response_seconds integer,
  -- Set while a customer message waits for a human reply; cleared by the reply.
  awaiting_reply_since timestamptz,
  sla_stage text,
  unread_count integer not null default 0,
  last_message_preview text,
  last_message_at timestamptz,
  bot_paused boolean not null default false,
  next_follow_up_at timestamptz,
  follow_up_note text,
  follow_up_notified_at timestamptz,
  order_id text,
  converted_at timestamptz,
  lost_reason text,
  closed_at timestamptz,
  manychat_inbox_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, manychat_contact_id)
);
create index if not exists social_leads_branch_activity on public.social_leads (org_id, branch_id, last_message_at desc);
create index if not exists social_leads_assigned on public.social_leads (assigned_to, status);
create index if not exists social_leads_awaiting on public.social_leads (awaiting_reply_since) where awaiting_reply_since is not null;
create index if not exists social_leads_follow_up on public.social_leads (next_follow_up_at) where next_follow_up_at is not null;

create table if not exists public.social_lead_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  lead_id uuid not null references public.social_leads(id) on delete cascade,
  -- in = customer, out = rep, bot = ManyChat automation, note = team only, system = events.
  direction text not null check (direction in ('in', 'out', 'bot', 'note', 'system')),
  kind text not null default 'text' check (kind in ('text', 'image', 'product', 'comment', 'event')),
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  sender_id uuid,
  sender_name text,
  status text not null default 'ok' check (status in ('ok', 'sending', 'failed')),
  error text,
  -- ManyChat may send the same event twice: one row per dedupe key.
  dedupe_key text,
  created_at timestamptz not null default now()
);
create index if not exists social_lead_messages_lead on public.social_lead_messages (lead_id, created_at);
create unique index if not exists social_lead_messages_dedupe on public.social_lead_messages (org_id, dedupe_key) where dedupe_key is not null;

create table if not exists public.social_lead_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  kind text not null,
  ok boolean not null default true,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists social_lead_events_recent on public.social_lead_events (org_id, created_at desc);

-- The lead an order came from (one live order per lead, like carts).
alter table public.orders add column if not exists source_social_lead_id uuid references public.social_leads(id) on delete set null;
create index if not exists orders_source_social_lead on public.orders (source_social_lead_id) where source_social_lead_id is not null;

alter table public.social_lead_settings enable row level security;
alter table public.social_leads enable row level security;
alter table public.social_lead_messages enable row level security;
alter table public.social_lead_events enable row level security;

-- Settings › General / Lead capture / Assignment / Templates (Bright's design): one place.
alter table public.social_lead_settings add column if not exists prefs jsonb not null default '{}'::jsonb;

-- "On Hold" (All Leads design).
alter table public.social_leads drop constraint if exists social_leads_status_check;
alter table public.social_leads add constraint social_leads_status_check check (status in (
  'comment_captured', 'dm_sent', 'engaged', 'new', 'in_conversation', 'hot', 'call_requested',
  'awaiting_customer', 'follow_up', 'on_hold', 'order_created', 'delivered', 'lost'));

-- Every follow-up scheduled, so Done / Overdue / follow-up conversion can be counted.
create table if not exists public.social_lead_follow_ups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  lead_id uuid not null references public.social_leads(id) on delete cascade,
  due_at timestamptz not null,
  note text,
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'cancelled')),
  rep_id uuid references public.users(id) on delete set null,
  created_by_name text,
  done_at timestamptz,
  auto boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists social_lead_follow_ups_due on public.social_lead_follow_ups (org_id, branch_id, status, due_at);
create index if not exists social_lead_follow_ups_lead on public.social_lead_follow_ups (lead_id);

-- ManyChat flows Protohub knows about (Sync from ManyChat, or seen in events via ?flow=).
create table if not exists public.social_lead_automations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  flow_key text not null,
  manychat_ns text,
  name text not null,
  description text,
  trigger text not null default 'comment' check (trigger in ('comment', 'keyword', 'time_delay', 'inactivity', 'after_reply', 'order_created', 'other')),
  status text not null default 'active' check (status in ('active', 'paused', 'draft')),
  template text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, branch_id, flow_key)
);

alter table public.social_lead_follow_ups enable row level security;
alter table public.social_lead_automations enable row level security;

-- Lead & Conversations (Settings design): tags and the Owner's custom fields per lead.
alter table public.social_leads add column if not exists tags text[] not null default '{}';
alter table public.social_leads add column if not exists custom_fields jsonb not null default '{}'::jsonb;
-- Off-hours auto-reply sent once per quiet spell.
alter table public.social_leads add column if not exists off_hours_reply_at timestamptz;
