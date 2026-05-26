create table if not exists public.whatsapp_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  provider text not null default 'baileys',
  connection_status text not null default 'disconnected',
  connected_phone text,
  connected_name text,
  last_connected_at timestamptz,
  last_error text,
  triggers jsonb not null default '{}'::jsonb,
  templates jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table if exists public.whatsapp_settings
  drop constraint if exists whatsapp_settings_provider_check;
alter table if exists public.whatsapp_settings
  add constraint whatsapp_settings_provider_check
  check (provider in ('baileys'));
alter table if exists public.whatsapp_settings
  drop constraint if exists whatsapp_settings_connection_status_check;
alter table if exists public.whatsapp_settings
  add constraint whatsapp_settings_connection_status_check
  check (connection_status in ('disconnected', 'pairing', 'connected', 'errored'));
create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id text,
  trigger text not null,
  audience text not null default 'staff',
  recipient_name text,
  recipient_phone text not null,
  normalized_phone text not null,
  body text not null,
  provider text not null default 'baileys',
  provider_message_id text,
  provider_status text,
  status text not null default 'queued',
  error_message text,
  retry_count integer not null default 0,
  next_retry_at timestamptz,
  last_retry_at timestamptz,
  scheduled_for timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table if exists public.whatsapp_messages
  drop constraint if exists whatsapp_messages_status_check;
alter table if exists public.whatsapp_messages
  add constraint whatsapp_messages_status_check
  check (status in ('queued', 'sent', 'delivered', 'failed', 'blocked', 'deferred'));
create index if not exists whatsapp_messages_org_created_idx
  on public.whatsapp_messages (org_id, created_at desc);
create index if not exists whatsapp_messages_queue_idx
  on public.whatsapp_messages (status, next_retry_at, scheduled_for, created_at);
