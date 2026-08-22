-- Bank accounts for the Cash Flow page.
--
-- Protohub's cash lands in more than one place - Opay and Moniepoint both take
-- agent remittances - so "how much cash do we have" cannot be answered by a
-- single running total. Each account carries its own opening balance and its
-- own movements.

create table if not exists bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  -- 'cash' is physical money in a drawer. It behaves identically to a bank
  -- account here, but is shown apart because "cash in hand" is a figure the
  -- Owner counts rather than reads off a statement.
  account_type text not null default 'bank',
  bank_name text not null default '',
  -- Only ever the last few digits. A full account number has no business being
  -- readable on a dashboard.
  account_number_last4 text not null default '',
  is_primary boolean not null default false,
  active boolean not null default true,
  opening_balance numeric not null default 0,
  opening_balance_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bank_accounts_type_check check (account_type in ('bank', 'cash')),
  constraint bank_accounts_last4_check check (account_number_last4 ~ '^[0-9]{0,4}$')
);

create index if not exists bank_accounts_org_idx on bank_accounts (org_id) where active;

-- Moving money between our OWN accounts is not cash flow: nothing entered or
-- left the business. Transfers are kept in their own table precisely so they
-- can show on an account's activity while being excluded from cash in/out.
create table if not exists bank_account_transfers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  from_account_id uuid not null references bank_accounts(id) on delete restrict,
  to_account_id uuid not null references bank_accounts(id) on delete restrict,
  amount numeric not null,
  transferred_at timestamptz not null default now(),
  -- Money can sit in flight between Opay and Moniepoint for hours. Until it is
  -- confirmed on the receiving side it is "pending to clear" and must not be
  -- counted as available on either account.
  cleared_at timestamptz,
  note text not null default '',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bank_account_transfers_amount_check check (amount > 0),
  constraint bank_account_transfers_distinct check (from_account_id <> to_account_id)
);

create index if not exists bank_account_transfers_org_idx
  on bank_account_transfers (org_id, transferred_at desc);

-- Which account the money actually moved through. Nullable on purpose: every
-- row recorded before today has no answer, and guessing one would invent a
-- bank history that never happened. Those read as "Unassigned" until someone
-- chooses to assign them.
alter table remittance_transactions add column if not exists bank_account_id uuid
  references bank_accounts(id) on delete set null;
alter table expenses add column if not exists bank_account_id uuid
  references bank_accounts(id) on delete set null;

create index if not exists remittance_transactions_bank_account_idx
  on remittance_transactions (bank_account_id) where bank_account_id is not null;
create index if not exists expenses_bank_account_idx
  on expenses (bank_account_id) where bank_account_id is not null;

alter table bank_accounts enable row level security;
alter table bank_account_transfers enable row level security;

drop policy if exists bank_accounts_select on bank_accounts;
create policy bank_accounts_select on bank_accounts
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));

drop policy if exists bank_account_transfers_select on bank_account_transfers;
create policy bank_account_transfers_select on bank_account_transfers
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));
