create table if not exists public.whatsapp_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'baileys',
  provider_message_id text,
  sender_name text,
  sender_phone text not null,
  normalized_phone text not null,
  receiver_phone text,
  message_type text not null default 'text',
  body text not null,
  linked_order_id text,
  metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table if exists public.whatsapp_inbox_messages
  drop constraint if exists whatsapp_inbox_messages_provider_check;
alter table if exists public.whatsapp_inbox_messages
  add constraint whatsapp_inbox_messages_provider_check
  check (provider in ('baileys'));
alter table if exists public.whatsapp_inbox_messages
  drop constraint if exists whatsapp_inbox_messages_message_type_check;
alter table if exists public.whatsapp_inbox_messages
  add constraint whatsapp_inbox_messages_message_type_check
  check (message_type in ('text', 'image', 'video', 'audio', 'document', 'button', 'list', 'unknown'));
create index if not exists whatsapp_inbox_messages_org_received_idx
  on public.whatsapp_inbox_messages (org_id, received_at desc);
create index if not exists whatsapp_inbox_messages_org_phone_idx
  on public.whatsapp_inbox_messages (org_id, normalized_phone, received_at desc);
