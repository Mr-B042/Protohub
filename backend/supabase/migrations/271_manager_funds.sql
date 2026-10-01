-- Manager Funds & Expenses (Bright, 1 Oct 2026).
--
-- The manager holds company money: customer payments, owner funding,
-- transfers from company accounts. She spends some, remits the rest. Protohub
-- does the maths:
--   Opening + Received - Spent - Remitted = Expected closing
--   Actual (counted by her) - Expected   = Variance  (actual - expected,
--                                          the sign every cash screen uses)
--
-- ⚠️ HER WALLET IS A COMPANY ACCOUNT (bank_accounts, account_type
-- 'manager_wallet'), so nothing is counted twice (Bright's choice):
--   customer payment  -> a remittance on the order (remittance_transactions,
--                        bank_account_id = wallet), exactly like an agent's
--   owner funding /
--   company transfer  -> bank_account_transfers  company -> wallet
--   expense           -> an expenses row, bank_account_id = wallet
--   remittance out    -> bank_account_transfers  wallet -> company
--   other money in    -> wallet ledger only (explanation + proof required);
--                        Cash Flow has no home for non-sales income
-- manager_fund_transactions is the manager's own ledger and points at the
-- mirrored rows so editing or voiding keeps them in step.
--
-- Stock purchases are deliberately NOT a category: product cost is counted
-- when an order sells, so an expense row would count it twice.
--
-- branch_id NOT NULL from the first row on every table, so they can all sit
-- in BRANCH_TABLES at once.

insert into storage.buckets (id, name, public, file_size_limit)
values ('manager-fund-evidence', 'manager-fund-evidence', false, 10485760)
on conflict (id) do nothing;

-- A manager wallet is an ordinary 'cash' account with a holder. Cash Flow
-- already understands cash accounts, so it lists the wallet and its balance
-- with no change; the holder is what makes it "Grace's wallet".
alter table public.bank_accounts add column if not exists holder_user_id uuid references public.users(id) on delete set null;
create unique index if not exists bank_accounts_branch_holder on public.bank_accounts (branch_id, holder_user_id) where holder_user_id is not null;

-- Proof rules, one row per branch, Owner-editable. Defaults are Bright's.
create table if not exists public.manager_fund_settings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  expense_proof_min numeric(12, 2) not null default 10000 check (expense_proof_min >= 0),
  remittance_proof_required boolean not null default true,
  owner_funding_reference_required boolean not null default true,
  other_in_proof_required boolean not null default true,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists manager_fund_settings_branch on public.manager_fund_settings (branch_id);

create table if not exists public.manager_fund_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  manager_id uuid not null references public.users(id) on delete cascade,
  wallet_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  -- The Sunday of the week the money moved in.
  week_start date not null,
  kind text not null check (kind in ('customer_payment', 'owner_funding', 'company_transfer_in', 'other_in', 'expense', 'remittance_out')),
  category text check (category is null or category in (
    'logistics', 'meta_ads', 'airtime_data', 'packaging', 'office', 'customer_refund',
    'staff_expense', 'transportation', 'repairs', 'miscellaneous', 'other'
  )),
  amount numeric(12, 2) not null check (amount > 0),
  occurred_at timestamptz not null,
  description text,
  paid_to text,
  payment_method text check (payment_method is null or payment_method in ('cash', 'transfer', 'pos', 'other')),
  reference text,
  order_ids text[] not null default '{}',
  -- The company account on the other side of a transfer in or out.
  counterparty_account_id uuid references public.bank_accounts(id) on delete set null,
  -- [{ path, name, mime, size, uploadedAt, uploadedBy }]
  evidence jsonb not null default '[]'::jsonb,
  -- Mirrored finance rows.
  expense_id text,
  transfer_id uuid references public.bank_account_transfers(id) on delete set null,
  remittance_transaction_ids uuid[] not null default '{}',
  status text not null default 'recorded' check (status in ('recorded', 'returned', 'voided')),
  return_reason text,
  void_reason text,
  voided_by uuid references public.users(id) on delete set null,
  voided_at timestamptz,
  -- Set when this entry is the approved correction of a locked-week entry.
  adjusts_transaction_id uuid references public.manager_fund_transactions(id) on delete set null,
  version integer not null default 1,
  created_by uuid references public.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'expense' or category is not null)
);
create index if not exists manager_fund_transactions_week on public.manager_fund_transactions (branch_id, manager_id, week_start);
create index if not exists manager_fund_transactions_wallet on public.manager_fund_transactions (wallet_account_id, occurred_at);

-- One row per manager per week: the opening, her counted closing, and the
-- frozen figures once the owner locks the week.
create table if not exists public.manager_fund_weeks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  manager_id uuid not null references public.users(id) on delete cascade,
  wallet_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  week_start date not null,
  opening_balance numeric(12, 2) not null default 0,
  -- 'carried' = last locked week's counted closing; 'first_week' = no history.
  opening_source text not null default 'first_week' check (opening_source in ('carried', 'first_week')),
  actual_closing numeric(12, 2),
  variance_explanation text,
  notes text,
  closing_snapshot jsonb,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists manager_fund_weeks_branch_manager_week on public.manager_fund_weeks (branch_id, manager_id, week_start);

-- After a lock, nothing is edited in place. A change is requested, the owner
-- decides, and an approved change is paid as a correcting entry in the week
-- that is running. Both values are kept.
create table if not exists public.manager_fund_adjustment_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  manager_id uuid not null references public.users(id) on delete cascade,
  transaction_id uuid not null references public.manager_fund_transactions(id) on delete cascade,
  original_amount numeric(12, 2) not null,
  requested_amount numeric(12, 2) not null check (requested_amount >= 0),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.users(id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  applied_transaction_id uuid references public.manager_fund_transactions(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists manager_fund_adjustment_requests_branch on public.manager_fund_adjustment_requests (branch_id, status);

-- The owner can return the week over a single transaction. Additive only:
-- the existing section check is left alone; a Funds return is stored with
-- section 'other' and this link, and shown as "Funds & Expenses".
alter table public.weekly_report_corrections add column if not exists fund_transaction_id uuid
  references public.manager_fund_transactions(id) on delete set null;

alter table public.manager_fund_settings enable row level security;
alter table public.manager_fund_transactions enable row level security;
alter table public.manager_fund_weeks enable row level security;
alter table public.manager_fund_adjustment_requests enable row level security;

create policy "manager fund settings select" on public.manager_fund_settings
  for select to authenticated
  using (org_id = private.auth_org_id() and private.auth_user_role()::text in ('Owner', 'Admin', 'Manager'));

create policy "manager fund transactions select" on public.manager_fund_transactions
  for select to authenticated
  using (org_id = private.auth_org_id() and (private.auth_user_role()::text in ('Owner', 'Admin') or manager_id = auth.uid()));

create policy "manager fund weeks select" on public.manager_fund_weeks
  for select to authenticated
  using (org_id = private.auth_org_id() and (private.auth_user_role()::text in ('Owner', 'Admin') or manager_id = auth.uid()));

create policy "manager fund adjustments select" on public.manager_fund_adjustment_requests
  for select to authenticated
  using (org_id = private.auth_org_id() and (private.auth_user_role()::text in ('Owner', 'Admin') or manager_id = auth.uid()));
