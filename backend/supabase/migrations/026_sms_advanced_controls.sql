alter table sms_settings
  add column if not exists quiet_hours_enabled boolean not null default false,
  add column if not exists quiet_hours_start text not null default '21:00',
  add column if not exists quiet_hours_end text not null default '08:00',
  add column if not exists low_balance_threshold integer not null default 200,
  add column if not exists auto_retry_enabled boolean not null default true,
  add column if not exists max_retry_attempts integer not null default 2,
  add column if not exists retry_backoff_minutes integer not null default 30,
  add column if not exists inbound_webhook_secret text;
alter table sms_messages
  add column if not exists cart_id text references abandoned_carts(id) on delete set null,
  add column if not exists retry_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_retry_at timestamptz;
create index if not exists idx_sms_messages_cart
  on sms_messages(cart_id, created_at desc);
create index if not exists idx_sms_messages_retry_queue
  on sms_messages(org_id, status, next_retry_at);
create table if not exists sms_opt_outs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  phone             text not null,
  normalized_phone  text not null,
  keyword           text,
  source            text not null default 'manual',
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, normalized_phone)
);
create trigger sms_opt_outs_updated_at
  before update on sms_opt_outs
  for each row execute function set_updated_at();
create index if not exists idx_sms_opt_outs_org_phone
  on sms_opt_outs(org_id, normalized_phone);
alter table sms_opt_outs enable row level security;
create policy "Owner/Admin see sms opt outs"
  on sms_opt_outs for select
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));
create policy "Owner/Admin manage sms opt outs"
  on sms_opt_outs for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));
create table if not exists sms_inbound_messages (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references organizations(id) on delete set null,
  provider          text not null default 'multitexter',
  sender_phone      text not null,
  normalized_phone  text not null,
  receiver          text,
  sender_name       text,
  body              text not null,
  keyword           text,
  action            text,
  linked_order_id   text references orders(id) on delete set null,
  metadata          jsonb not null default '{}'::jsonb,
  processed         boolean not null default false,
  processed_at      timestamptz,
  received_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now()
);
create trigger sms_inbound_messages_updated_at
  before update on sms_inbound_messages
  for each row execute function set_updated_at();
create index if not exists idx_sms_inbound_org_created
  on sms_inbound_messages(org_id, created_at desc);
create index if not exists idx_sms_inbound_phone
  on sms_inbound_messages(org_id, normalized_phone, created_at desc);
alter table sms_inbound_messages enable row level security;
create policy "Owner/Admin see sms inbound"
  on sms_inbound_messages for select
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));
create policy "Owner/Admin manage sms inbound"
  on sms_inbound_messages for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));
