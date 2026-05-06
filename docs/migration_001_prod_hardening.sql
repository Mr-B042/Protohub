-- =====================================================================
-- Migration 001: Production Hardening
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard
-- =====================================================================

-- ── 1. Login audit table ─────────────────────────────────────────────
create table if not exists public.login_audit (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  success    boolean not null,
  ip         inet,
  created_at timestamptz not null default now()
);

create index if not exists login_audit_email_idx on public.login_audit (email, created_at desc);

-- ── 2. Order status audit log ────────────────────────────────────────
create table if not exists public.order_audit (
  id           uuid primary key default gen_random_uuid(),
  order_id     text not null,
  org_id       uuid not null,
  changed_by   uuid references public.users(id),
  from_status  text,
  to_status    text not null,
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists order_audit_order_idx on public.order_audit (order_id, created_at desc);
create index if not exists order_audit_org_idx   on public.order_audit (org_id, created_at desc);

-- ── 3. Performance indexes ───────────────────────────────────────────
create index if not exists orders_org_created_idx   on public.orders (org_id, created_at desc);
create index if not exists orders_org_status_idx    on public.orders (org_id, status);
create index if not exists orders_org_rep_idx       on public.orders (org_id, assigned_rep_id);
create index if not exists orders_customer_idx      on public.orders (org_id, customer);
create index if not exists orders_phone_idx         on public.orders (org_id, phone);
create index if not exists products_org_idx         on public.products (org_id);
create index if not exists stock_movements_org_idx  on public.stock_movements (org_id, created_at desc);
create index if not exists stock_movements_prod_idx on public.stock_movements (product_id, created_at desc);
create index if not exists expenses_org_created_idx on public.expenses (org_id, created_at desc);
create index if not exists agents_org_idx           on public.agents (org_id);

-- ── 4. Row Level Security ────────────────────────────────────────────
alter table public.organizations   enable row level security;
alter table public.users           enable row level security;
alter table public.products        enable row level security;
alter table public.orders          enable row level security;
alter table public.agents          enable row level security;
alter table public.stock_movements enable row level security;
alter table public.expenses        enable row level security;
alter table public.waybills        enable row level security;
alter table public.login_audit     enable row level security;
alter table public.order_audit     enable row level security;

-- ── 5. Helper function ───────────────────────────────────────────────
create or replace function public.auth_org_id()
returns uuid language sql stable security definer as $$
  select org_id from public.users where id = auth.uid();
$$;

-- ── 6. RLS Policies ─────────────────────────────────────────────────
-- Drop first so re-running this script is safe (PG15 has no CREATE POLICY IF NOT EXISTS)

-- organizations
drop policy if exists "org members only" on public.organizations;
create policy "org members only"
  on public.organizations for all
  using (id = public.auth_org_id());

-- users
drop policy if exists "same org users" on public.users;
create policy "same org users"
  on public.users for all
  using (org_id = public.auth_org_id());

-- products
drop policy if exists "same org products" on public.products;
create policy "same org products"
  on public.products for all
  using (org_id = public.auth_org_id());

-- orders
drop policy if exists "same org orders" on public.orders;
create policy "same org orders"
  on public.orders for all
  using (org_id = public.auth_org_id());

-- agents
drop policy if exists "same org agents" on public.agents;
create policy "same org agents"
  on public.agents for all
  using (org_id = public.auth_org_id());

-- stock_movements
drop policy if exists "same org stock_movements" on public.stock_movements;
create policy "same org stock_movements"
  on public.stock_movements for all
  using (org_id = public.auth_org_id());

-- expenses
drop policy if exists "same org expenses" on public.expenses;
create policy "same org expenses"
  on public.expenses for all
  using (org_id = public.auth_org_id());

-- waybills
drop policy if exists "same org waybills" on public.waybills;
create policy "same org waybills"
  on public.waybills for all
  using (org_id = public.auth_org_id());

-- login_audit: no direct user access (service-role only)
drop policy if exists "no direct access login_audit" on public.login_audit;
create policy "no direct access login_audit"
  on public.login_audit for all
  using (false);

-- order_audit: org members can read their own audit trail
drop policy if exists "same org order_audit read" on public.order_audit;
create policy "same org order_audit read"
  on public.order_audit for select
  using (org_id = public.auth_org_id());
