-- Personal WhatsApp order dispatch for assigned users.
-- Keeps the existing org-level whatsapp_settings automation intact.

create table if not exists public.whatsapp_user_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  enabled boolean not null default false,
  provider text not null default 'baileys',
  connection_status text not null default 'disconnected',
  connected_phone text,
  connected_name text,
  last_connected_at timestamptz,
  last_error text,
  pairing_mode text,
  pairing_phone text,
  pairing_code text,
  qr_code_data_url text,
  risk_acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

alter table if exists public.whatsapp_user_accounts
  drop constraint if exists whatsapp_user_accounts_provider_check;
alter table if exists public.whatsapp_user_accounts
  add constraint whatsapp_user_accounts_provider_check
  check (provider in ('baileys'));

alter table if exists public.whatsapp_user_accounts
  drop constraint if exists whatsapp_user_accounts_connection_status_check;
alter table if exists public.whatsapp_user_accounts
  add constraint whatsapp_user_accounts_connection_status_check
  check (connection_status in ('disconnected', 'pairing', 'connecting', 'connected', 'errored'));

alter table if exists public.whatsapp_user_accounts
  drop constraint if exists whatsapp_user_accounts_pairing_mode_check;
alter table if exists public.whatsapp_user_accounts
  add constraint whatsapp_user_accounts_pairing_mode_check
  check (pairing_mode is null or pairing_mode in ('qr', 'pairing_code'));

drop trigger if exists whatsapp_user_accounts_updated_at on public.whatsapp_user_accounts;
create trigger whatsapp_user_accounts_updated_at
  before update on public.whatsapp_user_accounts
  for each row execute function set_updated_at();

create index if not exists whatsapp_user_accounts_org_user_idx
  on public.whatsapp_user_accounts (org_id, user_id);
create index if not exists whatsapp_user_accounts_org_status_idx
  on public.whatsapp_user_accounts (org_id, connection_status);

create table if not exists public.whatsapp_user_destinations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  label text not null,
  destination_type text not null default 'manual_group',
  group_jid text,
  phone text,
  notes text,
  active boolean not null default true,
  is_default boolean not null default false,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.whatsapp_user_destinations
  drop constraint if exists whatsapp_user_destinations_type_check;
alter table if exists public.whatsapp_user_destinations
  add constraint whatsapp_user_destinations_type_check
  check (destination_type in ('group', 'phone', 'manual_group'));

drop trigger if exists whatsapp_user_destinations_updated_at on public.whatsapp_user_destinations;
create trigger whatsapp_user_destinations_updated_at
  before update on public.whatsapp_user_destinations
  for each row execute function set_updated_at();

create index if not exists whatsapp_user_destinations_org_user_active_idx
  on public.whatsapp_user_destinations (org_id, user_id, active);
create unique index if not exists whatsapp_user_destinations_one_default_idx
  on public.whatsapp_user_destinations (org_id, user_id)
  where is_default;

create table if not exists public.whatsapp_order_dispatches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade,
  sender_user_id uuid not null references public.users(id) on delete cascade,
  destination_id uuid references public.whatsapp_user_destinations(id) on delete set null,
  send_mode text not null,
  destination_type text not null,
  destination_label text not null,
  recipient_jid text,
  recipient_phone text,
  body text not null,
  status text not null default 'opened',
  provider text not null default 'baileys',
  provider_message_id text,
  provider_status text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table if exists public.whatsapp_order_dispatches
  drop constraint if exists whatsapp_order_dispatches_mode_check;
alter table if exists public.whatsapp_order_dispatches
  add constraint whatsapp_order_dispatches_mode_check
  check (send_mode in ('assisted', 'direct'));

alter table if exists public.whatsapp_order_dispatches
  drop constraint if exists whatsapp_order_dispatches_destination_type_check;
alter table if exists public.whatsapp_order_dispatches
  add constraint whatsapp_order_dispatches_destination_type_check
  check (destination_type in ('group', 'phone', 'manual_group'));

alter table if exists public.whatsapp_order_dispatches
  drop constraint if exists whatsapp_order_dispatches_status_check;
alter table if exists public.whatsapp_order_dispatches
  add constraint whatsapp_order_dispatches_status_check
  check (status in ('opened', 'queued', 'sent', 'failed', 'blocked', 'rate_limited'));

create index if not exists whatsapp_order_dispatches_org_created_idx
  on public.whatsapp_order_dispatches (org_id, created_at desc);
create index if not exists whatsapp_order_dispatches_sender_created_idx
  on public.whatsapp_order_dispatches (org_id, sender_user_id, created_at desc);
create index if not exists whatsapp_order_dispatches_order_created_idx
  on public.whatsapp_order_dispatches (org_id, order_id, created_at desc);
create index if not exists whatsapp_order_dispatches_direct_rate_idx
  on public.whatsapp_order_dispatches (org_id, sender_user_id, send_mode, created_at desc);
