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

-- Index for fast lookups by email (abuse detection)
create index if not exists login_audit_email_idx on public.login_audit (email, created_at desc);

-- Auto-purge rows older than 90 days (keeps the table small)
-- Run this as a cron job in Supabase or schedule it manually:
-- delete from public.login_audit where created_at < now() - interval '90 days';

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
-- Orders — most queried table
create index if not exists orders_org_created_idx    on public.orders (org_id, created_at desc);
create index if not exists orders_org_status_idx     on public.orders (org_id, status);
create index if not exists orders_org_rep_idx        on public.orders (org_id, assigned_rep_id);
create index if not exists orders_customer_idx       on public.orders (org_id, customer);
create index if not exists orders_phone_idx          on public.orders (org_id, phone);

-- Products
create index if not exists products_org_idx          on public.products (org_id);

-- Stock movements
create index if not exists stock_movements_org_idx   on public.stock_movements (org_id, created_at desc);
create index if not exists stock_movements_prod_idx  on public.stock_movements (product_id, created_at desc);

-- Expenses
create index if not exists expenses_org_created_idx  on public.expenses (org_id, created_at desc);

-- Agents
create index if not exists agents_org_idx            on public.agents (org_id);

-- ── 4. Row Level Security ────────────────────────────────────────────
-- Enable RLS on all tables (service-role key bypasses this;
-- anon/user keys must pass the policies below)

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

-- Helper: get the org_id for the calling user
create or replace function public.auth_org_id()
returns uuid language sql stable security definer as $$
  select org_id from public.users where id = auth.uid();
$$;

-- Organizations: users can only see their own org
create policy if not exists "org members only"
  on public.organizations for all
  using (id = public.auth_org_id());

-- Users: only see users in same org
create policy if not exists "same org users"
  on public.users for all
  using (org_id = public.auth_org_id());

-- Products: only see products in same org
create policy if not exists "same org products"
  on public.products for all
  using (org_id = public.auth_org_id());

-- Orders: only see orders in same org
create policy if not exists "same org orders"
  on public.orders for all
  using (org_id = public.auth_org_id());

-- Agents: only see agents in same org
create policy if not exists "same org agents"
  on public.agents for all
  using (org_id = public.auth_org_id());

-- Stock movements: only see movements in same org
create policy if not exists "same org stock_movements"
  on public.stock_movements for all
  using (org_id = public.auth_org_id());

-- Expenses: only see expenses in same org
create policy if not exists "same org expenses"
  on public.expenses for all
  using (org_id = public.auth_org_id());

-- Waybills: only see waybills in same org
create policy if not exists "same org waybills"
  on public.waybills for all
  using (org_id = public.auth_org_id());

-- Login audit: no user-level access (server-side only via service role)
create policy if not exists "no direct access login_audit"
  on public.login_audit for all
  using (false);

-- Order audit: users can read their own org's audit trail
create policy if not exists "same org order_audit read"
  on public.order_audit for select
  using (org_id = public.auth_org_id());
