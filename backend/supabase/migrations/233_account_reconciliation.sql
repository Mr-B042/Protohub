-- Account reconciliation: our books for ONE account against its statement.
--
-- Weekly Reconciliation asks whether the business as a whole holds what it
-- thinks. This asks the narrower, harder question per account: does GTBank
-- agree with us, line by line? A week can reconcile in total while one account
-- is out by exactly what another is out the other way.
--
-- ⚠️ Sign convention, shared with Weekly Reconciliation and fixed everywhere:
-- difference = STATEMENT − BOOKS. Negative means the bank holds less than we
-- recorded (money missing); positive means money arrived we never wrote down.
-- The supplied design computed this the other way round on one screen; using
-- both would put two opposite meanings on the same minus sign.

create table if not exists account_reconciliations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  bank_account_id uuid not null references bank_accounts(id) on delete cascade,
  statement_date date not null,
  -- What the bank says, typed from the statement.
  statement_balance numeric not null default 0,
  -- What our books said at that date. Snapshotted for the same reason the
  -- weekly count is: a backdated expense must not silently restate a
  -- reconciliation that has already been signed off.
  book_balance numeric not null default 0,
  status text not null default 'in_progress',
  notes text not null default '',
  reconciled_by uuid references users(id) on delete set null,
  reconciled_by_name text not null default '',
  reconciled_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_reconciliations_unique unique (org_id, bank_account_id, statement_date),
  constraint account_reconciliations_status_check check (status in ('in_progress', 'reconciled')),
  constraint account_reconciliations_notes_len check (char_length(notes) <= 250)
);

create index if not exists account_reconciliations_org_date_idx
  on account_reconciliations (org_id, statement_date desc);

-- Which of OUR recorded movements have been ticked off against the statement.
-- Presence of a row means matched; there is no unmatched row, so the set of
-- unmatched items is always derived from live data and can never go stale.
create table if not exists account_reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references account_reconciliations(id) on delete cascade,
  source_type text not null,
  -- Text rather than uuid: expenses and remittances use uuids but transfers
  -- and future sources may not, and a match is a reference, not a foreign key.
  source_id text not null,
  matched_at timestamptz not null default now(),
  constraint account_reconciliation_matches_source_check
    check (source_type in ('expense', 'remittance', 'transfer')),
  constraint account_reconciliation_matches_unique unique (reconciliation_id, source_type, source_id)
);

create index if not exists account_reconciliation_matches_parent_idx
  on account_reconciliation_matches (reconciliation_id);

-- Lines that exist on the statement but not in our books: bank charges, VAT,
-- interest. There is no statement import, so these are typed in - which is
-- exactly what they are, an entry made from reading the statement.
create table if not exists account_reconciliation_adjustments (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references account_reconciliations(id) on delete cascade,
  occurred_on date,
  description text not null default '',
  amount numeric not null,
  direction text not null default 'out',
  kind text not null default 'other',
  created_at timestamptz not null default now(),
  constraint account_reconciliation_adjustments_amount_check check (amount > 0),
  constraint account_reconciliation_adjustments_direction_check check (direction in ('in', 'out')),
  constraint account_reconciliation_adjustments_kind_check
    check (kind in ('bank_charge', 'interest', 'vat', 'transfer', 'other')),
  constraint account_reconciliation_adjustments_desc_len check (char_length(description) <= 200)
);

create index if not exists account_reconciliation_adjustments_parent_idx
  on account_reconciliation_adjustments (reconciliation_id);

alter table account_reconciliations enable row level security;
alter table account_reconciliation_matches enable row level security;
alter table account_reconciliation_adjustments enable row level security;

drop policy if exists account_reconciliations_select on account_reconciliations;
create policy account_reconciliations_select on account_reconciliations
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));

drop policy if exists account_reconciliation_matches_select on account_reconciliation_matches;
create policy account_reconciliation_matches_select on account_reconciliation_matches
  for select to authenticated
  using (reconciliation_id in (
    select id from account_reconciliations
    where org_id in (select org_id from users where id = auth.uid())
  ));

drop policy if exists account_reconciliation_adjustments_select on account_reconciliation_adjustments;
create policy account_reconciliation_adjustments_select on account_reconciliation_adjustments
  for select to authenticated
  using (reconciliation_id in (
    select id from account_reconciliations
    where org_id in (select org_id from users where id = auth.uid())
  ));
