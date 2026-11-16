-- Expense & Cost Intelligence (Bright, 16 Nov 2026): 10-tab rebuild of the
-- Expenses page. Pending requests live in their OWN table and only reach
-- `expenses` when approved, so no existing expense total changes.

-- 1. Accountant role: records/requests expenses; theirs wait for Owner,
--    Admin or Manager. Kept out of orders like Delivery Agent (they need none).
alter type public.user_role add value if not exists 'Accountant';

drop policy if exists "Reps and marketers see scoped orders, others see all" on public.orders;
create policy "Reps and marketers see scoped orders, others see all"
  on public.orders for select
  using (
    org_id = private.auth_org_id()
    and (
      private.auth_user_role()::text not in ('Sales Rep', 'Recovery Rep', 'Sales Closer', 'Marketer', 'Delivery Agent', 'Accountant')
      or (private.auth_user_role()::text in ('Sales Rep', 'Recovery Rep', 'Sales Closer') and assigned_rep_id = auth.uid())
      or (private.auth_user_role()::text = 'Marketer' and private.marketing_order_matches_current_user(orders))
    )
  );

-- 2. Who recorded an expense and whether it was checked.
--    auto       = booked by the system from its source (order delivery fee,
--                 Meta/TikTok spend, payroll, incentives, waybill record)
--    verified   = recorded or checked by Owner/Admin/Manager (or approved)
--    unchecked  = recorded by another role (rep delivery fee, logistics waybill)
alter table public.expenses add column if not exists check_status text not null default 'verified'
  check (check_status in ('auto', 'verified', 'unchecked'));
alter table public.expenses add column if not exists recorded_by uuid;
alter table public.expenses add column if not exists recorded_by_name text;
alter table public.expenses add column if not exists checked_by_name text;
alter table public.expenses add column if not exists checked_at timestamptz;
alter table public.expenses add column if not exists receipt_url text;
alter table public.expenses add column if not exists request_id uuid;

update public.expenses set check_status = 'auto'
 where check_status <> 'auto'
   and (id like 'EXP-DEL-%' or id like 'ads-auto-%' or id like 'ads-tiktok-%' or id like 'incentive-%'
        or id like 'SAL-WEEKLY-%' or id like 'EXP-WB-%');

-- 3. Expense requests (Approvals tab).
create table if not exists public.expense_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  code text not null,
  category text not null,
  product_id text,
  amount numeric not null check (amount > 0),
  purpose text not null,
  department text not null,
  payment_source text not null,
  expense_date date not null,
  receipt_url text,
  requested_by uuid not null,
  requested_by_name text not null,
  requested_by_role text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  expense_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists expense_requests_code on public.expense_requests (org_id, code);
create index if not exists expense_requests_branch on public.expense_requests (org_id, branch_id, created_at desc);
alter table public.expense_requests enable row level security;

-- 4. Monthly budgets per category ("recurring" = repeats until changed).
create table if not exists public.expense_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  category text not null,
  amount numeric not null check (amount >= 0),
  recurring boolean not null default false,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  unique (org_id, branch_id, month, category)
);
alter table public.expense_budgets enable row level security;

-- 5. Per-branch settings: approval limits, budget alert steps, departments.
create table if not exists public.expense_settings (
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  approval_rules jsonb not null default '[{"upTo":25000,"role":"Manager"},{"upTo":100000,"role":"Admin"},{"upTo":null,"role":"Owner"}]',
  budget_alert_steps jsonb not null default '[50,75,90,100]',
  departments jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (org_id, branch_id)
);
alter table public.expense_settings enable row level security;

-- 6. What was done about an alert (Resolve / Dismiss / Assign).
create table if not exists public.expense_alert_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  alert_key text not null,
  action text not null check (action in ('resolved', 'dismissed', 'assigned')),
  assigned_to uuid,
  assigned_to_name text,
  note text,
  by_name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, branch_id, alert_key)
);
alter table public.expense_alert_actions enable row level security;

-- 7. Cost Optimization action plan.
create table if not exists public.expense_savings_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  title text not null,
  target text not null default '',
  expected_savings numeric not null default 0,
  realized_savings numeric not null default 0,
  owner_department text not null default '',
  owner_user uuid,
  owner_name text,
  due_date date,
  status text not null default 'not_started' check (status in ('not_started', 'pending', 'in_progress', 'approved', 'done')),
  source_key text,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.expense_savings_plans enable row level security;

-- 8. Scheduled report emails (Reports & Forecasts).
create table if not exists public.expense_report_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  report text not null,
  frequency text not null check (frequency in ('weekly', 'monthly')),
  emails text[] not null,
  active boolean not null default true,
  last_sent_at timestamptz,
  created_by_name text not null,
  created_at timestamptz not null default now()
);
alter table public.expense_report_schedules enable row level security;

-- 9. Receipts: private bucket, read through short-lived signed links only.
insert into storage.buckets (id, name, public) values ('expense-receipts', 'expense-receipts', false)
on conflict (id) do nothing;

-- 10. In-app alert to approvers when a request comes in.
alter type public.notification_type add value if not exists 'expense_request';
