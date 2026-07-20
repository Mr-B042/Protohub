-- Migration 164: Backend Recovery and Retention Sales Rep role + KPI system.
--
-- New role for reps who work ONLY recovered/returning-customer orders
-- (never fresh leads), measured on net contribution + 5 supporting KPIs
-- instead of the normal Sales Rep bonus system.

-- 1. New role, same technique as migration 101 (Marketer role).
alter type public.user_role add value if not exists 'Recovery Rep';

-- 2. Org-level KPI target settings - one row per org, Owner-editable,
--    same shape/convention as rep_weekly_targets (migration 156).
create table if not exists public.recovery_rep_kpi_settings (
  org_id                    uuid primary key references public.organizations(id) on delete cascade,
  monthly_target_min        numeric not null default 380000,
  monthly_target_preferred  numeric not null default 400000,
  weekly_pace_target        numeric not null default 95000,
  min_delivery_rate_pct     numeric not null default 65,
  upsell_attempt_rate_pct   numeric not null default 85,
  documentation_rate_pct    numeric not null default 95,
  rep_monthly_salary        numeric not null default 70000,
  updated_by                uuid references public.users(id) on delete set null,
  updated_at                timestamptz not null default now()
);

alter table public.recovery_rep_kpi_settings enable row level security;

drop policy if exists "recovery rep kpi settings select" on public.recovery_rep_kpi_settings;
drop policy if exists "recovery rep kpi settings write owner" on public.recovery_rep_kpi_settings;
drop policy if exists "recovery rep kpi settings update owner" on public.recovery_rep_kpi_settings;

create policy "recovery rep kpi settings select"
  on public.recovery_rep_kpi_settings
  for select
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager', 'Recovery Rep')
  );

create policy "recovery rep kpi settings write owner"
  on public.recovery_rep_kpi_settings
  for insert
  to authenticated
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );

create policy "recovery rep kpi settings update owner"
  on public.recovery_rep_kpi_settings
  for update
  to authenticated
  using (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  )
  with check (
    org_id = private.auth_org_id()
    and private.auth_user_role()::text = 'Owner'
  );

-- 3. Consent/opt-out extension of the EXISTING customer_flags row - this
-- table is already phone-unique (one row per phone), so a second
-- independent flag lives on the same row rather than a new table.
-- `reason` must become nullable: an opt-out-only phone has no high-risk
-- reason to record.
alter table public.customer_flags alter column reason drop not null;
alter table public.customer_flags add column if not exists blocks_followup boolean not null default false;
alter table public.customer_flags add column if not exists blocks_followup_reason text;
alter table public.customer_flags add column if not exists blocks_followup_by uuid references public.users(id) on delete set null;
alter table public.customer_flags add column if not exists blocks_followup_at timestamptz;

create index if not exists idx_customer_flags_blocks_followup
  on public.customer_flags(org_id, phone) where blocks_followup = true;

-- 4. RLS fix: the orders/abandoned_carts SELECT policies (currently from
-- migration 101) scope 'Sales Rep' to their own assigned_rep_id and let
-- every other role see the whole org - a new 'Recovery Rep' would fall
-- into "every other role" and see ALL orders/carts org-wide over Realtime
-- without this fix, mirroring the same over-permissioning bug found and
-- fixed in sales-expansion-orders.ts's canAccessOrder for the Express layer.
drop policy if exists "Reps and marketers see scoped orders, others see all" on public.orders;
create policy "Reps and marketers see scoped orders, others see all"
  on public.orders for select
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text not in ('Sales Rep', 'Recovery Rep', 'Marketer')
      or (private.auth_user_role()::text in ('Sales Rep', 'Recovery Rep') and assigned_rep_id = auth.uid())
      or (private.auth_user_role()::text = 'Marketer' and private.marketing_order_matches_current_user(orders))
    )
  );

drop policy if exists "Reps and marketers see scoped carts, others see all" on public.abandoned_carts;
create policy "Reps and marketers see scoped carts, others see all"
  on public.abandoned_carts for select
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text not in ('Sales Rep', 'Recovery Rep', 'Marketer')
      or (private.auth_user_role()::text in ('Sales Rep', 'Recovery Rep') and assigned_rep_id = auth.uid())
      or (private.auth_user_role()::text = 'Marketer' and private.marketing_cart_matches_current_user(abandoned_carts))
    )
  );
