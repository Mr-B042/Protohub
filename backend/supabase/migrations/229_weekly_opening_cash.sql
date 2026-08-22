-- Weekly opening cash: the counted figure a week's accounting starts from.
--
-- Protohub accounts weekly, so cash flow needs a real starting balance every
-- week rather than one anchor that drifts forever. The Owner counts what is
-- actually in each account on the first day and the week runs from there,
-- which also makes the previous week's CLOSING cash checkable against what is
-- really in the bank.

-- Which week an anchor belongs to. Null means an ad-hoc anchor set outside the
-- weekly rhythm, which is still allowed.
alter table cash_opening_balances add column if not exists week_start date;

-- One anchor per week. A correction replaces the week's figure rather than
-- stacking a second one that silently loses to ordering.
create unique index if not exists cash_opening_balances_week_unique
  on cash_opening_balances (org_id, week_start) where week_start is not null;

-- The per-account split behind a week's total. Kept because "we opened with
-- ₦3.1m" is not checkable, while "₦1.4m in Opay and ₦0.8m in Moniepoint" can
-- be held against the actual statements.
create table if not exists cash_opening_balance_sources (
  id uuid primary key default gen_random_uuid(),
  opening_balance_id uuid not null references cash_opening_balances(id) on delete cascade,
  bank_account_id uuid references bank_accounts(id) on delete set null,
  -- Kept alongside the id so a deleted account still names itself in history.
  account_label text not null default '',
  amount numeric not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists cash_opening_balance_sources_parent_idx
  on cash_opening_balance_sources (opening_balance_id);

alter table cash_opening_balance_sources enable row level security;

drop policy if exists cash_opening_balance_sources_select on cash_opening_balance_sources;
create policy cash_opening_balance_sources_select on cash_opening_balance_sources
  for select to authenticated
  using (opening_balance_id in (
    select id from cash_opening_balances
    where org_id in (select org_id from users where id = auth.uid())
  ));
