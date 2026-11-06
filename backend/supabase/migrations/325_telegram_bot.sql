-- Telegram Automation Center (Bright, 6 Nov 2026). One bot per organisation
-- sends staff their alerts on Telegram: new orders, follow-up reminders,
-- failed deliveries, low stock, daily reports, announcements, and any phone
-- alert the Owner chooses to forward. Written and read by the server only
-- (RLS on, no policies): the bot token never reaches a browser.

create table if not exists public.telegram_bots (
  org_id uuid primary key,
  token text not null,
  bot_id bigint,
  username text,
  name text,
  webhook_secret text not null,
  webhook_url text,
  status text not null default 'connected',
  last_error text,
  connected_at timestamptz not null default now(),
  connected_by uuid,
  -- daily/weekly report hour, commands on/off, forwarded alert kinds
  settings jsonb not null default '{}'::jsonb,
  -- {"2026-11-06": {"ok": 40, "total": 41}}: webhook checks per Lagos day
  health jsonb not null default '{}'::jsonb,
  last_health_at timestamptz,
  last_update_at timestamptz,
  updated_at timestamptz not null default now()
);

-- A staff member's Telegram chat (one per person).
create table if not exists public.telegram_links (
  user_id uuid primary key,
  org_id uuid not null,
  chat_id text not null,
  -- the bot this chat started; a different bot connected later cannot reach it
  bot_id bigint,
  telegram_username text,
  telegram_name text,
  linked_at timestamptz not null default now()
);
create index if not exists telegram_links_org on public.telegram_links (org_id);
create unique index if not exists telegram_links_org_chat on public.telegram_links (org_id, chat_id);

-- One-time codes behind the "Connect my Telegram" link (t.me/<bot>?start=<code>).
create table if not exists public.telegram_link_codes (
  code text primary key,
  org_id uuid not null,
  user_id uuid not null,
  created_by uuid,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists telegram_link_codes_user on public.telegram_link_codes (user_id);

create table if not exists public.telegram_automations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  trigger text not null,
  name text not null,
  enabled boolean not null default true,
  -- {"roles": ["Owner"], "assignedRep": true, "userIds": []}
  recipients jsonb not null default '{}'::jsonb,
  -- e.g. {"threshold": 5} for low stock, {"hour": 9} for the daily report
  settings jsonb not null default '{}'::jsonb,
  built_in boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists telegram_automations_org on public.telegram_automations (org_id, trigger);

-- Every message the bot sends (or failed to send). dedupe_key stops the same
-- reminder going to the same person twice.
create table if not exists public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  automation_id uuid,
  trigger text not null,
  user_id uuid,
  chat_id text,
  order_id text,
  dedupe_key text,
  batch_id uuid,
  title text,
  preview text,
  status text not null default 'sending',
  error text,
  telegram_message_id bigint,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists telegram_messages_org_time on public.telegram_messages (org_id, created_at desc);
create index if not exists telegram_messages_batch on public.telegram_messages (batch_id) where batch_id is not null;
create unique index if not exists telegram_messages_dedupe on public.telegram_messages (org_id, user_id, dedupe_key) where dedupe_key is not null;

alter table public.telegram_bots enable row level security;
alter table public.telegram_links enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_automations enable row level security;
alter table public.telegram_messages enable row level security;
