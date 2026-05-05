-- ============================================================
-- Row Level Security (RLS) Policies
-- Every user can only see their own organization's data.
-- ============================================================

-- Enable RLS on all tables
alter table organizations          enable row level security;
alter table users                  enable row level security;
alter table products               enable row level security;
alter table product_pricings       enable row level security;
alter table product_packages       enable row level security;
alter table agents                 enable row level security;
alter table agent_stock            enable row level security;
alter table orders                 enable row level security;
alter table stock_movements        enable row level security;
alter table abandoned_carts        enable row level security;
alter table expenses               enable row level security;
alter table pay_structures         enable row level security;
alter table payroll_runs           enable row level security;
alter table waybill_records        enable row level security;
alter table customer_flags         enable row level security;
alter table system_notifications   enable row level security;
alter table stock_count_sessions   enable row level security;
alter table stock_count_entries    enable row level security;

-- ── Helper function ───────────────────────────────────────
-- Returns the org_id of the currently logged-in user
create or replace function auth_org_id()
returns uuid language sql stable as $$
  select org_id from users where id = auth.uid()
$$;

-- ── Helper: current user role ─────────────────────────────
create or replace function auth_user_role()
returns user_role language sql stable as $$
  select role from users where id = auth.uid()
$$;

-- ── ORGANIZATIONS ─────────────────────────────────────────
create policy "Users see own org"
  on organizations for select
  using (id = auth_org_id());

-- ── USERS ─────────────────────────────────────────────────
create policy "Users see own org members"
  on users for select
  using (org_id = auth_org_id());

create policy "Admins/Owners manage users"
  on users for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── PRODUCTS ──────────────────────────────────────────────
create policy "All org members see products"
  on products for select
  using (org_id = auth_org_id());

create policy "Owner/Admin/Inventory manage products"
  on products for all
  using (
    org_id = auth_org_id()
    and auth_user_role() in ('Owner', 'Admin', 'Inventory Manager')
  );

-- ── PRODUCT PRICINGS ──────────────────────────────────────
create policy "All org members see pricings"
  on product_pricings for select
  using (
    exists (
      select 1 from products p
      where p.id = product_id and p.org_id = auth_org_id()
    )
  );

create policy "Owner/Admin/Inventory manage pricings"
  on product_pricings for all
  using (
    exists (
      select 1 from products p
      where p.id = product_id and p.org_id = auth_org_id()
    )
    and auth_user_role() in ('Owner', 'Admin', 'Inventory Manager')
  );

-- ── PRODUCT PACKAGES ──────────────────────────────────────
create policy "All org members see packages"
  on product_packages for select
  using (
    exists (
      select 1 from products p
      where p.id = product_id and p.org_id = auth_org_id()
    )
  );

create policy "Owner/Admin/Inventory manage packages"
  on product_packages for all
  using (
    exists (
      select 1 from products p
      where p.id = product_id and p.org_id = auth_org_id()
    )
    and auth_user_role() in ('Owner', 'Admin', 'Inventory Manager')
  );

-- ── AGENTS ────────────────────────────────────────────────
create policy "All org members see agents"
  on agents for select
  using (org_id = auth_org_id());

create policy "Owner/Admin manage agents"
  on agents for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── AGENT STOCK ───────────────────────────────────────────
create policy "All org members see agent stock"
  on agent_stock for select
  using (
    exists (
      select 1 from agents a where a.id = agent_id and a.org_id = auth_org_id()
    )
  );

create policy "Owner/Admin/Inventory manage agent stock"
  on agent_stock for all
  using (
    exists (
      select 1 from agents a where a.id = agent_id and a.org_id = auth_org_id()
    )
    and auth_user_role() in ('Owner', 'Admin', 'Inventory Manager')
  );

-- ── ORDERS ────────────────────────────────────────────────
-- Sales reps see only their assigned orders; others see all
create policy "Reps see own orders, others see all"
  on orders for select
  using (
    org_id = auth_org_id()
    and (
      auth_user_role() in ('Owner', 'Admin', 'Inventory Manager')
      or assigned_rep_id = auth.uid()
    )
  );

create policy "All org members create orders"
  on orders for insert
  with check (org_id = auth_org_id());

create policy "All org members update own org orders"
  on orders for update
  using (
    org_id = auth_org_id()
    and (
      auth_user_role() in ('Owner', 'Admin')
      or assigned_rep_id = auth.uid()
    )
  );

create policy "Owner/Admin delete orders"
  on orders for delete
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── STOCK MOVEMENTS ───────────────────────────────────────
create policy "All org members see stock movements"
  on stock_movements for select
  using (org_id = auth_org_id());

create policy "Owner/Admin/Inventory insert movements"
  on stock_movements for insert
  with check (
    org_id = auth_org_id()
    and auth_user_role() in ('Owner', 'Admin', 'Inventory Manager')
  );

-- ── ABANDONED CARTS ───────────────────────────────────────
create policy "All org members see carts"
  on abandoned_carts for select
  using (org_id = auth_org_id());

create policy "All org members manage carts"
  on abandoned_carts for all
  using (org_id = auth_org_id());

-- ── EXPENSES ──────────────────────────────────────────────
create policy "Owner/Admin see expenses"
  on expenses for select
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

create policy "Owner/Admin manage expenses"
  on expenses for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── PAY STRUCTURES ────────────────────────────────────────
create policy "Owner/Admin manage pay structures"
  on pay_structures for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── PAYROLL RUNS ──────────────────────────────────────────
create policy "Owner/Admin manage payroll"
  on payroll_runs for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── WAYBILL RECORDS ───────────────────────────────────────
create policy "All org members see waybills"
  on waybill_records for select
  using (org_id = auth_org_id());

create policy "Owner/Admin/Inventory manage waybills"
  on waybill_records for all
  using (
    org_id = auth_org_id()
    and auth_user_role() in ('Owner', 'Admin', 'Inventory Manager')
  );

-- ── CUSTOMER FLAGS ────────────────────────────────────────
create policy "All org members see flags"
  on customer_flags for select
  using (org_id = auth_org_id());

create policy "Owner/Admin manage flags"
  on customer_flags for all
  using (org_id = auth_org_id() and auth_user_role() in ('Owner', 'Admin'));

-- ── SYSTEM NOTIFICATIONS ──────────────────────────────────
create policy "All org members see notifications"
  on system_notifications for select
  using (org_id = auth_org_id());

create policy "System inserts notifications"
  on system_notifications for insert
  with check (org_id = auth_org_id());

create policy "All org members mark read"
  on system_notifications for update
  using (org_id = auth_org_id());

-- ── STOCK COUNT SESSIONS ──────────────────────────────────
create policy "All org members see count sessions"
  on stock_count_sessions for select
  using (org_id = auth_org_id());

create policy "Owner/Admin/Inventory manage count sessions"
  on stock_count_sessions for all
  using (
    org_id = auth_org_id()
    and auth_user_role() in ('Owner', 'Admin', 'Inventory Manager')
  );

-- ── STOCK COUNT ENTRIES ───────────────────────────────────
create policy "All org members see count entries"
  on stock_count_entries for select
  using (
    exists (
      select 1 from stock_count_sessions s
      where s.id = session_id and s.org_id = auth_org_id()
    )
  );

create policy "Owner/Admin/Inventory manage count entries"
  on stock_count_entries for all
  using (
    exists (
      select 1 from stock_count_sessions s
      where s.id = session_id and s.org_id = auth_org_id()
    )
    and auth_user_role() in ('Owner', 'Admin', 'Inventory Manager')
  );
