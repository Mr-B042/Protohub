-- ============================================================
-- ProtoHub CRM — Initial Schema
-- Run this in Supabase SQL Editor or via: supabase db push
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";
-- ── ORGANIZATIONS ─────────────────────────────────────────
-- One row per business. Every other table references this.
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid,                          -- set after first user created
  created_at  timestamptz not null default now()
);
-- ── USERS ─────────────────────────────────────────────────
-- Mirrors Supabase auth.users. Extended with role + org.
create type user_role as enum ('Owner', 'Admin', 'Sales Rep', 'Inventory Manager');
create table users (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  email       text not null,
  role        user_role not null default 'Sales Rep',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
-- Back-fill org owner once user exists
alter table organizations
  add constraint fk_owner foreign key (owner_id)
  references users(id) on delete set null;
-- ── PRODUCTS ──────────────────────────────────────────────
create table products (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  name             text not null,
  sku              text not null,
  description      text,
  warehouse_stock  integer not null default 0 check (warehouse_stock >= 0),
  agent_stock      integer not null default 0 check (agent_stock >= 0),
  units_sold       integer not null default 0 check (units_sold >= 0),
  reorder_point    integer not null default 10,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (org_id, sku)
);
-- ── PRODUCT PRICINGS ──────────────────────────────────────
create type currency_code as enum ('NGN', 'USD', 'GBP');
create table product_pricings (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references products(id) on delete cascade,
  currency       currency_code not null default 'NGN',
  selling_price  numeric(12,2) not null default 0,
  unit_cost      numeric(12,2) not null default 0,
  is_primary     boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (product_id, currency)
);
-- ── PRODUCT PACKAGES ──────────────────────────────────────
create table product_packages (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references products(id) on delete cascade,
  name            text not null,
  description     text,
  quantity        integer not null default 1,
  price           numeric(12,2) not null default 0,
  currency        currency_code not null default 'NGN',
  display_order   integer not null default 0,
  active          boolean not null default true,
  upsell_from_qty integer,
  upsell_to_qty   integer,
  created_at      timestamptz not null default now()
);
-- ── DELIVERY AGENTS ───────────────────────────────────────
create type agent_status as enum ('Active', 'Inactive', 'Suspended');
create table agents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  zone        text not null,
  phone       text,
  status      agent_status not null default 'Active',
  created_at  timestamptz not null default now()
);
-- ── AGENT STOCK ───────────────────────────────────────────
create table agent_stock (
  id          uuid primary key default gen_random_uuid(),
  agent_id    uuid not null references agents(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  quantity    integer not null default 0 check (quantity >= 0),
  updated_at  timestamptz not null default now(),
  unique (agent_id, product_id)
);
-- ── ORDERS ────────────────────────────────────────────────
create type order_status as enum (
  'New', 'Confirmed', 'In Process', 'Dispatched',
  'Delivered', 'Cancelled', 'Postponed', 'Failed'
);
create type order_source as enum ('TikTok', 'Facebook', 'WhatsApp', 'Website', 'Direct');
create type call_outcome as enum (
  'Confirmed', 'No Answer', 'Wrong Number',
  'Refused', 'Scheduled Callback', 'Not Reached'
);
create table orders (
  id                 text primary key,          -- preserves ORD-XXXX format
  org_id             uuid not null references organizations(id) on delete cascade,
  customer           text not null,
  phone              text not null,
  whatsapp           text,
  email              text,
  address            text,
  city               text,
  state              text,
  product_id         uuid references products(id) on delete set null,
  package_id         uuid references product_packages(id) on delete set null,
  product_name       text not null,
  package_name       text,
  quantity           integer not null default 1,
  amount             numeric(12,2) not null default 0,
  currency           currency_code not null default 'NGN',
  status             order_status not null default 'New',
  source             order_source,
  location           text,
  assigned_rep_id    uuid references users(id) on delete set null,
  agent_id           uuid references agents(id) on delete set null,
  response           text,
  notes              text,
  call_outcome       call_outcome,
  stock_deducted     boolean not null default false,
  delivered_date     date,
  scheduled_date     date,
  utm_source         text,
  utm_campaign       text,
  date               text,                      -- display label e.g. "May 5, 2026"
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- ── STOCK MOVEMENTS ───────────────────────────────────────
create type stock_movement_type as enum (
  'Stock Added', 'Distributed to Agent', 'Order Fulfilled',
  'Return', 'Correction', 'Waybill Out', 'Waybill In'
);
create table stock_movements (
  id            text primary key,
  org_id        uuid not null references organizations(id) on delete cascade,
  product_id    uuid references products(id) on delete set null,
  product_name  text not null,
  type          stock_movement_type not null,
  qty           integer not null,
  balance_after integer not null,
  agent_id      uuid references agents(id) on delete set null,
  order_id      text references orders(id) on delete set null,
  by_user_id    uuid references users(id) on delete set null,
  by_name       text,                           -- denormalized display name
  note          text,
  created_at    timestamptz not null default now()
);
-- ── ABANDONED CARTS ───────────────────────────────────────
create type cart_status as enum (
  'Open abandoned', 'Assigned', 'Contacted', 'Converted', 'Lost'
);
create table abandoned_carts (
  id               text primary key,
  org_id           uuid not null references organizations(id) on delete cascade,
  customer         text,
  phone            text not null,
  whatsapp         text,
  city             text,
  state            text,
  product_id       uuid references products(id) on delete set null,
  package_id       uuid references product_packages(id) on delete set null,
  product_name     text,
  package_name     text,
  amount           numeric(12,2),
  currency         currency_code not null default 'NGN',
  source           text,
  status           cart_status not null default 'Open abandoned',
  assigned_rep_id  uuid references users(id) on delete set null,
  last_activity    timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
-- ── EXPENSES ──────────────────────────────────────────────
create table expenses (
  id          text primary key,
  org_id      uuid not null references organizations(id) on delete cascade,
  date        date not null,
  category    text not null,
  description text,
  amount      numeric(12,2) not null default 0,
  currency    currency_code not null default 'NGN',
  paid_by     text,
  created_at  timestamptz not null default now()
);
-- ── PAY STRUCTURES ────────────────────────────────────────
create table pay_structures (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  fixed_salary   numeric(12,2) not null default 0,
  commission_pct numeric(5,2) not null default 0,
  updated_at     timestamptz not null default now(),
  unique (org_id, user_id)
);
-- ── PAYROLL RUNS ──────────────────────────────────────────
create type payroll_status as enum ('Draft', 'Approved', 'Paid');
create table payroll_runs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  period      text not null,                    -- e.g. "May 2026"
  status      payroll_status not null default 'Draft',
  entries     jsonb not null default '[]',      -- [{user_id, name, delivered, fixed_salary, commission, total}]
  created_at  timestamptz not null default now(),
  approved_at timestamptz
);
-- ── WAYBILL RECORDS ───────────────────────────────────────
create type waybill_status as enum ('In Transit', 'Received', 'Returned', 'Cancelled');
create table waybill_records (
  id              text primary key,
  org_id          uuid not null references organizations(id) on delete cascade,
  product_id      uuid references products(id) on delete set null,
  product_name    text not null,
  quantity        integer not null,
  waybill_fee     numeric(12,2) not null default 0,
  from_location   text,
  to_location     text,
  carrier         text,
  tracking_number text,
  agent_id        uuid references agents(id) on delete set null,
  status          waybill_status not null default 'In Transit',
  notes           text,
  dispatched_date date,
  received_date   date,
  created_at      timestamptz not null default now()
);
-- ── CUSTOMER FLAGS ────────────────────────────────────────
create table customer_flags (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  phone       text not null,                    -- normalized (digits only)
  reason      text not null,
  flagged_by  uuid references users(id) on delete set null,
  flagged_at  timestamptz not null default now(),
  unique (org_id, phone)
);
-- ── SYSTEM NOTIFICATIONS ──────────────────────────────────
create type notification_type as enum ('low_stock', 'remittance_overdue', 'info');
create table system_notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  type        notification_type not null,
  message     text not null,
  read        boolean not null default false,
  product_id  uuid references products(id) on delete set null,
  created_at  timestamptz not null default now()
);
-- ── STOCK COUNT SESSIONS ──────────────────────────────────
create type session_status as enum ('Open', 'Closed');
create table stock_count_sessions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  title       text not null,
  status      session_status not null default 'Open',
  created_by  uuid references users(id) on delete set null,
  closed_at   timestamptz,
  created_at  timestamptz not null default now()
);
-- ── STOCK COUNT ENTRIES ───────────────────────────────────
create type count_status as enum (
  'Pending', 'Agent Submitted', 'Admin Confirmed', 'Verified', 'Discrepancy'
);
create type writeoff_reason as enum (
  'Damaged', 'Theft', 'Unreported Sale', 'Return to Warehouse', 'Other'
);
create table stock_count_entries (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references stock_count_sessions(id) on delete cascade,
  product_id          uuid references products(id) on delete set null,
  product_name        text not null,
  agent_id            uuid references agents(id) on delete set null,
  agent_name          text not null,
  system_qty          integer not null,
  agent_count         integer,
  admin_count         integer,
  variance            integer,
  status              count_status not null default 'Pending',
  writeoff_reason     writeoff_reason,
  writeoff_custom     text,                     -- when reason = 'Other'
  notes               text,
  agent_submitted_at  timestamptz,
  admin_confirmed_at  timestamptz,
  verified_at         timestamptz
);
-- ── UPDATED_AT TRIGGERS ───────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger orders_updated_at
  before update on orders
  for each row execute function set_updated_at();
create trigger agent_stock_updated_at
  before update on agent_stock
  for each row execute function set_updated_at();
-- ── INDEXES ───────────────────────────────────────────────
create index idx_orders_org_id         on orders(org_id);
create index idx_orders_status         on orders(org_id, status);
create index idx_orders_phone          on orders(org_id, phone);
create index idx_orders_created_at     on orders(org_id, created_at desc);
create index idx_orders_rep            on orders(assigned_rep_id);
create index idx_products_org_id       on products(org_id);
create index idx_stock_movements_org   on stock_movements(org_id, created_at desc);
create index idx_stock_movements_prod  on stock_movements(product_id);
create index idx_agent_stock_agent     on agent_stock(agent_id);
create index idx_notifications_org     on system_notifications(org_id, read, created_at desc);
create index idx_customer_flags_phone  on customer_flags(org_id, phone);
