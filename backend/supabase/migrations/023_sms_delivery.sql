-- Migration 023: SMS delivery foundation for Multitexter-based customer
-- messaging. Adds per-org SMS settings plus a durable message log that can
-- later support retries, DLR sync, and UI reporting.

-- ── sms_settings ─────────────────────────────────────────
create table if not exists sms_settings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null unique references organizations(id) on delete cascade,
  enabled       boolean not null default false,
  provider      text not null default 'multitexter',
  api_key       text not null default '',
  sender_name   text not null default 'Protohub',
  triggers      jsonb not null default '{}',
  templates     jsonb not null default '{}',
  updated_at    timestamptz
);

create trigger sms_settings_updated_at
  before update on sms_settings
  for each row execute function set_updated_at();

alter table sms_settings enable row level security;

create policy "Owner/Admin see sms settings"
  on sms_settings for select
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

create policy "Owner/Admin manage sms settings"
  on sms_settings for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── sms_messages ─────────────────────────────────────────
create table if not exists sms_messages (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations(id) on delete cascade,
  order_id             text references orders(id) on delete set null,
  trigger              text not null,
  audience             text not null default 'customer',
  recipient_name       text,
  recipient_phone      text not null,
  normalized_phone     text not null,
  body                 text not null,
  sender_name          text not null,
  provider             text not null default 'multitexter',
  provider_message_id  text,
  provider_status      text,
  status               text not null default 'queued',
  units                integer not null default 0,
  segments             integer not null default 1,
  error_code           text,
  error_message        text,
  scheduled_for        timestamptz,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger sms_messages_updated_at
  before update on sms_messages
  for each row execute function set_updated_at();

create index if not exists idx_sms_messages_org_created
  on sms_messages(org_id, created_at desc);

create index if not exists idx_sms_messages_org_status
  on sms_messages(org_id, status, created_at desc);

create index if not exists idx_sms_messages_order
  on sms_messages(order_id, created_at desc);

create index if not exists idx_sms_messages_provider_id
  on sms_messages(provider, provider_message_id);

create index if not exists idx_sms_messages_phone
  on sms_messages(org_id, normalized_phone, created_at desc);

alter table sms_messages enable row level security;

create policy "Owner/Admin see sms logs"
  on sms_messages for select
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

create policy "Owner/Admin update sms logs"
  on sms_messages for update
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

create policy "System inserts sms logs"
  on sms_messages for insert
  with check (org_id = auth_org_id());
