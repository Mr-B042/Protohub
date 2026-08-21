-- Delivery rate goals for the Manager Dashboard's Active Order Summary.
--
-- Each product card gets a progress bar against a PRIMARY target and a
-- STRETCH target. Defaults live on the organisation (same pattern as the
-- smart_stock_* settings already there); a product only gets its own row once
-- someone sets custom goals for it, so an org with no opinion carries no rows.

alter table organizations
  add column if not exists delivery_goal_primary_target integer not null default 65,
  add column if not exists delivery_goal_stretch_target integer not null default 70;

comment on column organizations.delivery_goal_primary_target is
  'Company-wide delivery rate goal (%) used by any product without custom goals.';
comment on column organizations.delivery_goal_stretch_target is
  'Company-wide stretch delivery rate goal (%).';

create table if not exists product_delivery_goals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  -- When false the product simply follows the company default. The row is kept
  -- rather than deleted so switching back to custom restores the last numbers
  -- instead of silently resetting them to 65/70.
  use_custom_goals boolean not null default true,
  primary_target integer not null default 65,
  stretch_target integer not null default 70,
  -- Which orders the goal is measured over. 'period' follows the dashboard's
  -- own period control; the other two pin the goal to a fixed window so a
  -- product's target does not move when someone changes the page filter.
  goal_basis text not null default 'period',
  show_progress_bar boolean not null default true,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (org_id, product_id),
  constraint product_delivery_goals_basis_check
    check (goal_basis in ('period', 'month', 'all_time')),
  -- A target outside 0-100 is not a delivery rate, and a stretch below the
  -- primary would make the second marker sit behind the first on the bar.
  constraint product_delivery_goals_primary_range check (primary_target between 0 and 100),
  constraint product_delivery_goals_stretch_range check (stretch_target between 0 and 100),
  constraint product_delivery_goals_stretch_above_primary check (stretch_target >= primary_target)
);

create index if not exists product_delivery_goals_org_idx on product_delivery_goals (org_id);

alter table product_delivery_goals enable row level security;

-- Read is org-scoped for signed-in staff; every write goes through the backend
-- service role, which is where the Owner/Admin/Manager gate is enforced.
drop policy if exists product_delivery_goals_select on product_delivery_goals;
create policy product_delivery_goals_select on product_delivery_goals
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));
