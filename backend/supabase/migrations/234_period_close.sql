-- Weekly close / period lock: the week is finished and the books are fixed.
--
-- ⚠️ Closing a week does NOT set next week's opening cash. The supplied design
-- said it would, but Protohub's rule is that a week opens on a COUNTED figure -
-- the wizard blocks on it precisely because an opening balance carried forward
-- from a computed closing is never checked against the actual accounts, which
-- is how a drift survives for months. Closing records the figure; next week's
-- wizard shows it to compare against, and the Owner still counts.

create table if not exists period_closes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- Sunday, the official week anchor shared with payroll, cash and bonuses.
  week_start date not null,
  status text not null default 'draft',
  closing_notes text not null default '',
  -- Snapshotted at close. What the week was signed off on must survive a
  -- backdated entry made afterwards, or a locked period silently restates.
  net_profit numeric not null default 0,
  total_revenue numeric not null default 0,
  total_cogs numeric not null default 0,
  operating_expenses numeric not null default 0,
  expected_closing_cash numeric not null default 0,
  actual_closing_cash numeric not null default 0,
  cash_variance numeric not null default 0,
  free_operating_cash numeric not null default 0,
  closed_by uuid references users(id) on delete set null,
  closed_by_name text not null default '',
  closed_at timestamptz,
  approved_by uuid references users(id) on delete set null,
  approved_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint period_closes_week_unique unique (org_id, week_start),
  constraint period_closes_status_check check (status in ('draft', 'closed', 'reopened')),
  constraint period_closes_notes_len check (char_length(closing_notes) <= 500)
);

create index if not exists period_closes_org_week_idx on period_closes (org_id, week_start desc);

-- Only the MANUAL checks live here. Computed checks are derived from live data
-- every time the page loads and are deliberately not storable: a tick-box that
-- can be set by hand is a claim, and letting one stand in for a computed fact
-- would let a week be closed on a green light nobody earned.
create table if not exists period_close_checks (
  id uuid primary key default gen_random_uuid(),
  period_close_id uuid not null references period_closes(id) on delete cascade,
  check_key text not null,
  done boolean not null default false,
  done_by uuid references users(id) on delete set null,
  done_by_name text not null default '',
  done_at timestamptz,
  constraint period_close_checks_unique unique (period_close_id, check_key)
);

create index if not exists period_close_checks_parent_idx on period_close_checks (period_close_id);

alter table period_closes enable row level security;
alter table period_close_checks enable row level security;

drop policy if exists period_closes_select on period_closes;
create policy period_closes_select on period_closes
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));

drop policy if exists period_close_checks_select on period_close_checks;
create policy period_close_checks_select on period_close_checks
  for select to authenticated
  using (period_close_id in (
    select id from period_closes
    where org_id in (select org_id from users where id = auth.uid())
  ));
