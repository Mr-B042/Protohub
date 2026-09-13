-- Give every branch its own books.
--
-- ⚠️ ONE SET OF BOOKS CANNOT HOLD THREE CURRENCIES. Nigeria trades in naira,
-- Accra in cedi, Nairobi in shilling. Today expenses, remittances, bank
-- accounts, payroll and the whole cash-flow chain are shared, so the first
-- cedi expense Accra records would be added to Nigeria's totals and counted in
-- Nigeria's profit.
--
-- Twenty-three tables. Most are empty - the cash-flow and reconciliation
-- features are young - so the real backfill is expenses, remittances and the
-- two bank accounts. Those three are read from a parent that already knows its
-- branch: a delivery expense belongs to the waybill it paid for, a remittance
-- to the order whose cash came in.
--
-- Same shape as migration 258: inherit where there is a parent, fall back to
-- the organisation's Nigeria Operations branch where there is not, index the
-- column, and add a trigger so nothing written from now on arrives without a
-- branch.

-- ── 1. The column ───────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'expenses','remittance_transactions','rep_penalties','payroll_runs','pay_structures',
    'bank_accounts','bank_account_transfers',
    'cash_opening_balances','cash_opening_balance_sources',
    'cash_reserves','cash_reserve_releases',
    'weekly_cash_verifications','weekly_cash_verification_accounts',
    'cash_variance_investigations','cash_variance_investigation_events',
    'account_reconciliations','account_reconciliation_matches','account_reconciliation_adjustments',
    'period_closes','period_close_checks',
    'batch_economics','batch_cost_tiers','batch_status_tier_map'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists branch_id uuid references public.branches(id) on delete restrict',
      t);
  end loop;
end $$;

-- ── 2. Roots first ──────────────────────────────────────────────────────────
-- ⚠️ ORDER MATTERS HERE, unlike 258. These tables form a chain - a
-- reconciliation hangs off a bank account, its matches hang off the
-- reconciliation - so a parent must be filled in before anything reads from it.
-- Every existing row was created in Nigeria; the other branches were seeded
-- empty in migration 256 and have never traded.
do $$
declare t text;
begin
  foreach t in array array[
    'bank_accounts','cash_opening_balances','weekly_cash_verifications','period_closes',
    'payroll_runs','pay_structures','batch_economics','batch_cost_tiers','batch_status_tier_map'
  ]
  loop
    execute format($f$
      update public.%I t set branch_id = b.id
      from public.branches b
      where t.branch_id is null and b.org_id = t.org_id
        and b.name = 'Nigeria Operations' and b.active
    $f$, t);
  end loop;
end $$;

-- ── 3. Money that belongs to something already branch-owned ─────────────────
-- A delivery expense paid for one waybill, and that waybill knows its branch.
update public.expenses e set branch_id = w.branch_id
from public.waybill_records w where w.id = e.waybill_id and e.branch_id is null;

-- A remittance is cash from one order.
update public.remittance_transactions r set branch_id = o.branch_id
from public.orders o where o.id = r.order_id and r.branch_id is null;

-- A penalty is usually about one order.
update public.rep_penalties p set branch_id = o.branch_id
from public.orders o where o.id = p.order_id and p.branch_id is null;

-- ── 4. Down the cash-flow chain ─────────────────────────────────────────────
update public.cash_reserves c set branch_id = a.branch_id
from public.bank_accounts a where a.id = c.bank_account_id and c.branch_id is null;

update public.account_reconciliations r set branch_id = a.branch_id
from public.bank_accounts a where a.id = r.bank_account_id and r.branch_id is null;

update public.bank_account_transfers t set branch_id = a.branch_id
from public.bank_accounts a where a.id = coalesce(t.from_account_id, t.to_account_id) and t.branch_id is null;

update public.cash_variance_investigations i set branch_id = v.branch_id
from public.weekly_cash_verifications v where v.id = i.verification_id and i.branch_id is null;

update public.cash_opening_balance_sources s set branch_id = o.branch_id
from public.cash_opening_balances o where o.id = s.opening_balance_id and s.branch_id is null;

update public.cash_reserve_releases r set branch_id = c.branch_id
from public.cash_reserves c where c.id = r.reserve_id and r.branch_id is null;

update public.weekly_cash_verification_accounts a set branch_id = v.branch_id
from public.weekly_cash_verifications v where v.id = a.verification_id and a.branch_id is null;

update public.cash_variance_investigation_events e set branch_id = i.branch_id
from public.cash_variance_investigations i where i.id = e.investigation_id and e.branch_id is null;

update public.account_reconciliation_matches m set branch_id = r.branch_id
from public.account_reconciliations r where r.id = m.reconciliation_id and m.branch_id is null;

update public.account_reconciliation_adjustments a set branch_id = r.branch_id
from public.account_reconciliations r where r.id = a.reconciliation_id and a.branch_id is null;

update public.period_close_checks c set branch_id = p.branch_id
from public.period_closes p where p.id = c.period_close_id and c.branch_id is null;

-- ── 5. Whatever had no parent to read from ──────────────────────────────────
-- A general expense pays for no waybill, and a penalty need not name an order.
do $$
declare t text;
begin
  foreach t in array array[
    'expenses','remittance_transactions','rep_penalties',
    'bank_account_transfers','cash_reserves','weekly_cash_verifications',
    'cash_variance_investigations','account_reconciliations'
  ]
  loop
    execute format($f$
      update public.%I t set branch_id = b.id
      from public.branches b
      where t.branch_id is null and b.org_id = t.org_id
        and b.name = 'Nigeria Operations' and b.active
    $f$, t);
  end loop;
end $$;

-- ── 6. Indexes ──────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'expenses','remittance_transactions','rep_penalties','payroll_runs','pay_structures',
    'bank_accounts','bank_account_transfers',
    'cash_opening_balances','cash_opening_balance_sources',
    'cash_reserves','cash_reserve_releases',
    'weekly_cash_verifications','weekly_cash_verification_accounts',
    'cash_variance_investigations','cash_variance_investigation_events',
    'account_reconciliations','account_reconciliation_matches','account_reconciliation_adjustments',
    'period_closes','period_close_checks',
    'batch_economics','batch_cost_tiers','batch_status_tier_map'
  ]
  loop
    execute format('create index if not exists %I on public.%I (branch_id)', t || '_branch_idx', t);
  end loop;
end $$;

-- ── 7. Nothing new arrives without a branch ─────────────────────────────────
-- ⚠️ Same reasoning as 258: until the writers set branch_id themselves, a row
-- saved today would land with no branch and disappear the moment filtering is
-- switched on - and for money that means an expense silently missing from the
-- books rather than a missing log line.
create or replace function public.assign_money_branch_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_branch uuid;
begin
  if new.branch_id is not null then return new; end if;

  begin
    case tg_table_name
      when 'expenses' then
        select w.branch_id into v_branch from public.waybill_records w where w.id = new.waybill_id;
      when 'remittance_transactions','rep_penalties' then
        select o.branch_id into v_branch from public.orders o where o.id = new.order_id;
      when 'cash_reserves','account_reconciliations' then
        select a.branch_id into v_branch from public.bank_accounts a where a.id = new.bank_account_id;
      when 'bank_account_transfers' then
        select a.branch_id into v_branch from public.bank_accounts a
        where a.id = coalesce(new.from_account_id, new.to_account_id);
      when 'cash_variance_investigations' then
        select v.branch_id into v_branch from public.weekly_cash_verifications v where v.id = new.verification_id;
      when 'cash_opening_balance_sources' then
        select o.branch_id into v_branch from public.cash_opening_balances o where o.id = new.opening_balance_id;
      when 'cash_reserve_releases' then
        select c.branch_id into v_branch from public.cash_reserves c where c.id = new.reserve_id;
      when 'weekly_cash_verification_accounts' then
        select v.branch_id into v_branch from public.weekly_cash_verifications v where v.id = new.verification_id;
      when 'cash_variance_investigation_events' then
        select i.branch_id into v_branch from public.cash_variance_investigations i where i.id = new.investigation_id;
      when 'account_reconciliation_matches','account_reconciliation_adjustments' then
        select r.branch_id into v_branch from public.account_reconciliations r where r.id = new.reconciliation_id;
      when 'period_close_checks' then
        select p.branch_id into v_branch from public.period_closes p where p.id = new.period_close_id;
      else
        v_branch := null;
    end case;
  exception when others then
    v_branch := null;
  end;

  if v_branch is null then
    begin
      select b.id into v_branch from public.branches b
      where b.org_id = new.org_id and b.name = 'Nigeria Operations' and b.active
      order by b.created_at limit 1;
    exception when others then
      v_branch := null;
    end;
  end if;

  new.branch_id := v_branch;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'expenses','remittance_transactions','rep_penalties','payroll_runs','pay_structures',
    'bank_accounts','bank_account_transfers',
    'cash_opening_balances','cash_opening_balance_sources',
    'cash_reserves','cash_reserve_releases',
    'weekly_cash_verifications','weekly_cash_verification_accounts',
    'cash_variance_investigations','cash_variance_investigation_events',
    'account_reconciliations','account_reconciliation_matches','account_reconciliation_adjustments',
    'period_closes','period_close_checks',
    'batch_economics','batch_cost_tiers','batch_status_tier_map'
  ]
  loop
    execute format('drop trigger if exists trg_assign_money_branch on public.%I', t);
    execute format(
      'create trigger trg_assign_money_branch before insert on public.%I for each row execute function public.assign_money_branch_id()',
      t);
  end loop;
end $$;
