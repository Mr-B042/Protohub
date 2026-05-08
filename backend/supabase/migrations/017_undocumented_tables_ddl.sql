-- Migration 017: CREATE TABLE IF NOT EXISTS for all tables that exist in
-- production but have no DDL on file. These were created via the Supabase
-- Dashboard SQL editor. Recording them here so `supabase db reset` (local
-- dev) recreates the full schema correctly.

-- ── login_audit ───────────────────────────────────────────
create table if not exists login_audit (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  success    boolean not null,
  ip         text,
  created_at timestamptz not null default now()
);

create index if not exists idx_login_audit_email
  on login_audit(email, created_at desc);

-- ── order_audit ───────────────────────────────────────────
create table if not exists order_audit (
  id          uuid primary key default gen_random_uuid(),
  order_id    text not null references orders(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  changed_by  uuid references users(id) on delete set null,
  from_status text,
  to_status   text,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_order_audit_order
  on order_audit(order_id, created_at desc);

create index if not exists idx_order_audit_org
  on order_audit(org_id, created_at desc);

-- ── email_settings ────────────────────────────────────────
create table if not exists email_settings (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null unique references organizations(id) on delete cascade,
  enabled          boolean not null default false,
  provider         text not null default 'mailjet',
  api_key_public   text not null default '',
  api_key_private  text not null default '',
  resend_api_key   text not null default '',
  from_name        text not null default '',
  from_email       text not null default '',
  reply_to         text not null default '',
  triggers         jsonb not null default '{}',
  templates        jsonb not null default '{}',
  updated_at       timestamptz
);

-- ── embed_settings ────────────────────────────────────────
create table if not exists embed_settings (
  id                            uuid primary key default gen_random_uuid(),
  org_id                        uuid not null unique references organizations(id) on delete cascade,
  state_field_mode              text not null default 'freetext',
  show_email                    boolean not null default false,
  show_whatsapp                 boolean not null default true,
  require_whatsapp              boolean not null default true,
  address_required              boolean not null default true,
  city_required                 boolean not null default true,
  show_package_name             boolean not null default false,
  ask_delivery                  boolean not null default false,
  delivery_input_style          text not null default 'quick',
  delivery_quick_today          boolean not null default true,
  delivery_quick_tomorrow       boolean not null default true,
  delivery_quick_next_tomorrow  boolean not null default false,
  delivery_range_min_days       integer not null default 0,
  delivery_range_max_days       integer not null default 7,
  require_confirmation          boolean not null default false,
  confirmation_text             text not null default '',
  show_commitment               boolean not null default false,
  commitment_text               text not null default '',
  allow_disagree                boolean not null default true,
  form_order_summary_enabled    boolean not null default true,
  form_order_summary_title      text not null default 'Your Order Summary',
  updated_at                    timestamptz
);

-- ── push_subscriptions ────────────────────────────────────
create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

-- ── sales_teams ───────────────────────────────────────────
create table if not exists sales_teams (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  lead_id     uuid references users(id) on delete set null,
  product_ids uuid[]  not null default '{}',
  member_ids  uuid[]  not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists idx_sales_teams_org
  on sales_teams(org_id, created_at desc);

-- ── rep_penalties ─────────────────────────────────────────
create table if not exists rep_penalties (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  rep_id             uuid not null references users(id) on delete cascade,
  rep_name           text not null,
  type               text not null,
  amount             numeric(12,2) not null default 0,
  remove_all_bonuses boolean not null default false,
  order_id           text references orders(id) on delete set null,
  reason             text,
  period             text,
  by_name            text,
  created_at         timestamptz not null default now()
);

create index if not exists idx_rep_penalties_org
  on rep_penalties(org_id, created_at desc);

create index if not exists idx_rep_penalties_rep
  on rep_penalties(rep_id, period);
