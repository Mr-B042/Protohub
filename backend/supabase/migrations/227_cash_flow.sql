-- Cash Flow: opening cash anchors.
--
-- Recorded cash in is agent remittances and recorded cash out is expenses.
-- Neither includes capital, owner drawings, transfers, or anything paid before
-- Protohub started keeping books, so a balance derived purely from those two
-- is "net cash generated since records began" and NOT the money in the bank.
-- Read as a bank figure it would be badly wrong.
--
-- So the Owner anchors it: a counted, real figure with the moment it was true.
-- Every balance on the page runs forward from the most recent anchor at or
-- before the period start.
--
-- A TABLE rather than a column on organizations, because the anchor is a
-- time series: each period gets its own, either carried forward from the last
-- period's closing cash or counted by hand, and the history has to survive so
-- a disputed balance can be traced to who set it and why.
create table if not exists cash_opening_balances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  -- The instant this figure was true. Anchors are applied newest-first at or
  -- before a period's start, so this is the ordering key for the whole page.
  effective_at timestamptz not null,
  amount numeric not null,
  -- 'carry_forward' took the previous period's closing cash; 'manual' was
  -- counted. Stored rather than inferred so the history can say which.
  method text not null default 'manual',
  reason text not null default '',
  set_by uuid references users(id) on delete set null,
  -- Kept alongside set_by so a deactivated or deleted user still shows a name
  -- in the audit history instead of a blank row.
  set_by_name text not null default '',
  created_at timestamptz not null default now(),
  constraint cash_opening_balances_method_check check (method in ('manual', 'carry_forward')),
  constraint cash_opening_balances_reason_len check (char_length(reason) <= 250)
);

-- The page always asks "the latest anchor at or before X".
create index if not exists cash_opening_balances_org_effective_idx
  on cash_opening_balances (org_id, effective_at desc);

alter table cash_opening_balances enable row level security;

-- Read is org-scoped for signed-in staff; writes go through the backend
-- service role, which enforces the Owner/Admin gate.
drop policy if exists cash_opening_balances_select on cash_opening_balances;
create policy cash_opening_balances_select on cash_opening_balances
  for select to authenticated
  using (org_id in (select org_id from users where id = auth.uid()));

-- Superseded by the table above before anything read them.
alter table organizations drop column if exists cash_opening_balance;
alter table organizations drop column if exists cash_opening_balance_date;
