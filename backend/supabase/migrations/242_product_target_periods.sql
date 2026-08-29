-- Monthly product contribution targets, the manager incentive attached to them,
-- the daily pace trail, and the recovery actions they generate.
--
-- ⚠️ "CONTRIBUTION" HERE IS NOT THE P&L's DIRECT PROFIT, and the difference is
-- larger than the target itself. The P&L computes
--   directProfit = revenue - (cogs + logistics + commissions)
-- which EXCLUDES advertising. This target deducts advertising as a direct cost:
--   contribution = delivered revenue - cogs - ad spend - logistics - commissions
-- Measured on Edge Brusher for Aug 2026 that is ₦2,516,600 against a ₦3,100,000
-- target (~81%), where the same month reads ~₦8.4m as Direct Profit - a target
-- passed weeks earlier and therefore meaningless. Ad spend on that one product
-- was ₦3,710,600, larger than the whole target, which is why the two
-- definitions cannot be used interchangeably and why this one is never called
-- "profit" in the UI. See [Profit Definitions] before adding any new figure
-- here: mixing measurement systems in one table is what made the upsell
-- per-rep rows sum to ₦61,000 under an ₦87,000 team total.
--
-- Packaging and discounts/refunds are deliberately ABSENT. The expense
-- categories that exist are Ad Spend, Delivery, Salary, Waybill, Other,
-- Airtime & Data and Failed Delivery; inventing manual-entry lines for the
-- other two would drift out of date rather than measure anything. Salary is
-- excluded on purpose - payroll is settled separately, as everywhere else.

create table if not exists target_periods (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  name text not null default '',
  period_start date not null,
  period_end date not null,

  -- The three contribution levels the incentive tiers key off. Kept here
  -- rather than on incentive_rules because they are TARGETS (what the business
  -- wants) - the multipliers next door are the REWARD for hitting them, and
  -- the Owner sets each independently.
  contribution_minimum numeric(14,2) not null default 0,
  contribution_target numeric(14,2) not null,
  contribution_exceptional numeric(14,2) not null default 0,

  -- Supporting levers. These do not pay a bonus on their own; they are how the
  -- recovery planner works out WHICH lever is behind when contribution is.
  order_target integer not null default 0,
  delivered_target integer not null default 0,
  pieces_target integer not null default 0,
  delivery_rate_target numeric(5,2) not null default 0,

  -- A ceiling, not a goal: spending less than this is good. Every Ad Spend row
  -- carries a product_id (179/179 in production), so this is measurable per
  -- product without any new data entry.
  ad_spend_ceiling numeric(14,2) not null default 0,

  status text not null default 'draft',
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One target per product per period. Re-running a month means editing the
  -- row, not stacking a second one that silently competes with it.
  unique (org_id, product_id, period_start),
  constraint target_periods_status_check
    check (status in ('draft', 'active', 'closed', 'settled')),
  constraint target_periods_dates_check check (period_end >= period_start),
  constraint target_periods_target_positive check (contribution_target > 0),
  constraint target_periods_rate_range check (delivery_rate_target between 0 and 100),
  -- The tiers must ascend or the incentive bands overlap and a single
  -- contribution figure could match two of them.
  constraint target_periods_levels_ascend
    check (contribution_exceptional = 0 or contribution_exceptional >= contribution_target),
  constraint target_periods_minimum_below_target
    check (contribution_minimum = 0 or contribution_minimum <= contribution_target)
);

create index if not exists target_periods_org_idx on target_periods (org_id);
create index if not exists target_periods_org_period_idx on target_periods (org_id, period_start desc);
create index if not exists target_periods_product_idx on target_periods (product_id);

-- ── Manager incentive ────────────────────────────────────
create table if not exists incentive_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  target_period_id uuid not null references target_periods(id) on delete cascade,
  manager_id uuid references users(id) on delete set null,

  base_reward numeric(14,2) not null default 0,
  minimum_multiplier numeric(6,2) not null default 50,
  target_multiplier numeric(6,2) not null default 100,
  exceptional_multiplier numeric(6,2) not null default 125,

  -- ⚠️ A REWARD IS PROVISIONAL UNTIL EVERY GATE IS TRUE. Contribution moves
  -- after month end - late ad invoices, returns, unreconciled agent cash - so
  -- a payout computed on the last day of the month is an estimate, not a
  -- settlement. Stored as jsonb so a gate can be added without a migration;
  -- the keys are month_closed, deliveries_verified, advertising_complete,
  -- returns_recorded, agent_cash_reconciled, data_integrity_confirmed.
  verification_gates jsonb not null default '{}'::jsonb,
  verification_status text not null default 'provisional',
  final_payout numeric(14,2),
  verified_by uuid references users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (target_period_id, manager_id),
  constraint incentive_rules_status_check
    check (verification_status in ('provisional', 'verified', 'settled', 'rejected')),
  constraint incentive_rules_multipliers_ascend
    check (exceptional_multiplier >= target_multiplier and target_multiplier >= minimum_multiplier),
  -- A settled row must carry the figure it settled on, or there is no record
  -- of what was actually paid once the targets are edited later.
  constraint incentive_rules_settled_has_payout
    check (verification_status <> 'settled' or final_payout is not null)
);

create index if not exists incentive_rules_org_idx on incentive_rules (org_id);
create index if not exists incentive_rules_period_idx on incentive_rules (target_period_id);

-- ── Daily pace trail ─────────────────────────────────────
-- One row per target per day. This is a SNAPSHOT table: it records what was
-- true on that date so the trend survives later edits to costs or targets.
create table if not exists daily_target_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  target_period_id uuid not null references target_periods(id) on delete cascade,
  snapshot_date date not null,

  actual_contribution numeric(14,2) not null default 0,
  actual_orders integer not null default 0,
  actual_delivered integer not null default 0,
  actual_pieces integer not null default 0,
  actual_delivery_rate numeric(5,2) not null default 0,
  actual_ad_spend numeric(14,2) not null default 0,

  expected_contribution numeric(14,2) not null default 0,
  expected_orders integer not null default 0,
  expected_delivered integer not null default 0,
  expected_pieces integer not null default 0,

  projected_contribution numeric(14,2) not null default 0,
  projected_orders integer not null default 0,
  projected_delivered integer not null default 0,
  projected_pieces integer not null default 0,

  required_daily_contribution numeric(14,2) not null default 0,
  required_daily_orders numeric(10,2) not null default 0,
  required_daily_delivered numeric(10,2) not null default 0,
  required_daily_pieces numeric(10,2) not null default 0,

  days_elapsed integer not null default 0,
  days_remaining integer not null default 0,
  status text not null default 'on_track',

  created_at timestamptz not null default now(),

  -- Variances are deliberately NOT stored. actual - expected is exact and free
  -- to compute; a stored copy is a second source of truth that drifts the
  -- moment either side is corrected.
  unique (target_period_id, snapshot_date),
  constraint daily_target_snapshots_status_check
    check (status in ('on_track', 'at_risk', 'behind', 'achieved'))
);

create index if not exists daily_target_snapshots_period_date_idx
  on daily_target_snapshots (target_period_id, snapshot_date desc);
create index if not exists daily_target_snapshots_org_idx on daily_target_snapshots (org_id);

-- ── Recovery actions ─────────────────────────────────────
-- ⚠️ THE POINT OF THE WHOLE FEATURE. A dashboard that says "orders are behind"
-- is a report. One that says "behind by 54 - add 2 orders a day, or lift pieces
-- per delivery from 4.2 to 4.7, or recover 12 pending deliveries" is a
-- management system. Each recommendation becomes a row here so it can be
-- assigned, dated and closed out with evidence.
create table if not exists recovery_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  target_period_id uuid not null references target_periods(id) on delete cascade,

  -- Which lever triggered it, and which of the plans A-E produced it.
  detected_problem text not null,
  plan_code text not null,
  recommended_action text not null,

  assigned_to uuid references users(id) on delete set null,
  due_date date,
  status text not null default 'open',
  -- What closing this action is worth in contribution, so a manager can rank
  -- them rather than working down the list in the order they appeared.
  financial_impact numeric(14,2) not null default 0,
  completion_evidence text not null default '',

  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint recovery_actions_status_check
    check (status in ('open', 'in_progress', 'done', 'dismissed')),
  constraint recovery_actions_plan_check
    check (plan_code in ('A', 'B', 'C', 'D', 'E')),
  constraint recovery_actions_problem_check
    check (detected_problem in ('none', 'orders', 'delivery_rate', 'pieces', 'contribution', 'ad_spend'))
);

create index if not exists recovery_actions_period_idx on recovery_actions (target_period_id, status);
create index if not exists recovery_actions_org_idx on recovery_actions (org_id);
create index if not exists recovery_actions_assignee_idx on recovery_actions (assigned_to) where assigned_to is not null;

-- ── RLS ──────────────────────────────────────────────────
-- Read is org-scoped for signed-in staff; every write goes through the backend
-- service role, which is where the Owner-only gate is enforced. Same shape as
-- product_delivery_goals (migration 226).
alter table target_periods enable row level security;
alter table incentive_rules enable row level security;
alter table daily_target_snapshots enable row level security;
alter table recovery_actions enable row level security;

drop policy if exists target_periods_select on target_periods;
create policy target_periods_select on target_periods
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));

-- ⚠️ Incentive rows carry another person's pay. Readable only by the manager
-- they belong to and by Owner/Admin - not by every signed-in colleague, which
-- the plain org-scoped policy above would have allowed.
drop policy if exists incentive_rules_select on incentive_rules;
create policy incentive_rules_select on incentive_rules
  for select to authenticated
  using (
    org_id in (select org_id from users where id = auth.uid())
    and (
      manager_id = auth.uid()
      or exists (
        select 1 from users u
        where u.id = auth.uid() and u.org_id = incentive_rules.org_id
          and u.role in ('Owner', 'Admin')
      )
    )
  );

drop policy if exists daily_target_snapshots_select on daily_target_snapshots;
create policy daily_target_snapshots_select on daily_target_snapshots
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));

drop policy if exists recovery_actions_select on recovery_actions;
create policy recovery_actions_select on recovery_actions
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));
