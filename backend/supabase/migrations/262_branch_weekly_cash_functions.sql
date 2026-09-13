-- ⚠️ ONE ROW PER ORGANISATION PER WEEK IS WRONG ONCE THERE ARE BRANCHES.
--
-- cash_opening_balances, weekly_cash_verifications and inventory_valuation_
-- snapshots are unique on (org_id, week_start), and the functions that write
-- them upsert on that same key. The first time Accra saved its opening cash for
-- a week, ON CONFLICT would have found NIGERIA'S row for that week and
-- overwritten it. Not a leak - a silent loss of Nigeria's figures, replaced by
-- Ghana's, with no error shown.
--
-- ⚠️ THE BRANCH FILTER CANNOT REACH INSIDE THESE. branchScopedFetch rewrites
-- REST table URLs; an RPC is not one, and these are SECURITY DEFINER besides.
-- Separating the tables was never going to be enough - the functions have to
-- know their own branch, and the routes have to tell them.
--
-- ⚠️ ADDED ALONGSIDE, NOT SWAPPED. The branch-keyed unique indexes are created
-- while the org-keyed ones stay, and the new functions are extra overloads, so
-- the currently deployed code keeps working throughout. Re-keying in one shot
-- would break every cash save in the window between this migration and the
-- deploy. Dropping the old indexes and overloads is a separate step, once the
-- new routes are live.

create unique index if not exists cash_opening_balances_branch_week_unique
  on public.cash_opening_balances (branch_id, week_start) where week_start is not null;
create unique index if not exists weekly_cash_verifications_branch_week_unique
  on public.weekly_cash_verifications (branch_id, week_start);
create unique index if not exists inventory_valuation_snapshots_branch_week_unique
  on public.inventory_valuation_snapshots (branch_id, week_start);

create or replace function public.save_weekly_opening_cash(
  p_org_id uuid, p_branch_id uuid, p_week_start date, p_amount numeric,
  p_reason text, p_set_by uuid, p_set_by_name text, p_sources jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid;
begin
  -- Refused rather than defaulted: guessing a branch here would write one
  -- country's cash position into another's books.
  if p_branch_id is null then
    raise exception 'BRANCH_REQUIRED|An opening balance must belong to a branch.';
  end if;
  insert into cash_opening_balances (
    org_id, branch_id, week_start, effective_at, amount, method, reason, set_by, set_by_name
  ) values (
    p_org_id, p_branch_id, p_week_start, (p_week_start::timestamp at time zone 'Africa/Lagos'),
    p_amount, 'manual', p_reason, p_set_by, p_set_by_name
  )
  on conflict (branch_id, week_start) where week_start is not null
  do update set
    amount = excluded.amount, reason = excluded.reason,
    set_by = excluded.set_by, set_by_name = excluded.set_by_name,
    effective_at = excluded.effective_at
  returning id into v_id;

  delete from cash_opening_balance_sources where opening_balance_id = v_id;
  insert into cash_opening_balance_sources (opening_balance_id, branch_id, bank_account_id, account_label, amount)
  select v_id, p_branch_id,
         nullif(item->>'bankAccountId', '')::uuid,
         coalesce(item->>'accountLabel', ''),
         coalesce((item->>'amount')::numeric, 0)
  from jsonb_array_elements(p_sources) as item;
  return v_id;
end;
$function$;

create or replace function public.save_weekly_cash_verification(
  p_org_id uuid, p_branch_id uuid, p_week_start date, p_expected numeric, p_actual numeric,
  p_status text, p_notes text, p_verified_by uuid, p_verified_by_name text, p_accounts jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_id uuid;
begin
  if p_branch_id is null then
    raise exception 'BRANCH_REQUIRED|A cash verification must belong to a branch.';
  end if;
  insert into weekly_cash_verifications (
    org_id, branch_id, week_start, expected_closing, actual_closing, status, notes,
    verified_by, verified_by_name, verified_at
  ) values (
    p_org_id, p_branch_id, p_week_start, p_expected, p_actual, p_status, coalesce(p_notes, ''),
    p_verified_by, coalesce(p_verified_by_name, ''),
    case when p_status = 'draft' then null else now() end
  )
  on conflict (branch_id, week_start)
  do update set
    expected_closing = excluded.expected_closing,
    actual_closing = excluded.actual_closing,
    status = excluded.status,
    notes = excluded.notes,
    verified_by = excluded.verified_by,
    verified_by_name = excluded.verified_by_name,
    verified_at = excluded.verified_at,
    updated_at = now()
  returning id into v_id;

  delete from weekly_cash_verification_accounts where verification_id = v_id;
  insert into weekly_cash_verification_accounts (
    verification_id, branch_id, bank_account_id, account_label, system_balance, actual_balance
  )
  select v_id, p_branch_id,
         nullif(item->>'bankAccountId', '')::uuid,
         coalesce(item->>'accountLabel', ''),
         coalesce((item->>'systemBalance')::numeric, 0),
         coalesce((item->>'actualBalance')::numeric, 0)
  from jsonb_array_elements(p_accounts) as item;
  return v_id;
end;
$function$;
