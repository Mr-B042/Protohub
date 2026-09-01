-- 245: teach claim_recovery_order that p_cap <= 0 means UNLIMITED.
--
-- ⚠️ THE CAP IS ENFORCED TWICE. 244 lifted the ceiling in the TypeScript route,
-- but claim_recovery_order() carries its own copy of the same two rules, and it
-- is the one that actually blocks the write. So claiming stayed broken with a
-- worse message than before:
--
--   "Claiming is switched off. Set an open-order limit in Recovery settings."
--
-- The route now passes p_cap = 0 (unlimited) and the function read 0 as "off",
-- exactly the contradiction 244 removed one layer higher up. This aligns the
-- function with the route and with atClaimCap() in lib/recovery-calendar.ts.
--
-- A positive p_cap still enforces the anti-hoarding ceiling from 205.
create or replace function public.claim_recovery_order(
  p_org_id uuid, p_order_id text, p_rep_id uuid, p_claimed_by uuid, p_cap integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders;
  v_rep public.users;
  v_current_role text;
  v_held integer;
  v_claimed_at timestamptz := clock_timestamp();
begin
  set local lock_timeout = '5s';
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':recovery:' || p_rep_id::text, 0));

  select * into v_rep from public.users
  where id = p_rep_id and org_id = p_org_id and active and role = 'Recovery Rep';
  if not found then raise exception 'Claims can only go to an active Recovery Rep.'; end if;

  select * into v_order from public.orders
  where id = p_order_id and org_id = p_org_id
  for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_order.assigned_rep_id = p_rep_id then raise exception 'That order is already theirs.'; end if;
  if v_order.review_hold is true then raise exception 'That order is held for review.'; end if;
  if not (v_order.status in ('Failed', 'Cancelled') or v_order.call_outcome = 'Product Unavailable') then
    raise exception 'Only failed, cancelled or rejected orders can be claimed for recovery.';
  end if;

  if v_order.assigned_rep_id is not null then
    select role into v_current_role from public.users where id = v_order.assigned_rep_id;
    if v_current_role = 'Recovery Rep' then
      raise exception 'That order has already been claimed by another Recovery Rep.';
    end if;
  end if;

  select count(*) into v_held from public.orders
  where org_id = p_org_id and assigned_rep_id = p_rep_id and status <> 'Delivered';
  -- p_cap <= 0 is UNLIMITED. Only a positive ceiling can refuse a claim.
  if p_cap > 0 and v_held >= p_cap then
    raise exception '% already holds % open orders, the limit is %.', v_rep.name, v_held, p_cap;
  end if;

  update public.orders set
    assigned_rep_id = p_rep_id,
    assigned_by_user_id = p_claimed_by,
    assigned_at = v_claimed_at,
    updated_at = v_claimed_at
  where id = p_order_id and org_id = p_org_id;

  insert into public.recovery_order_claims (org_id, order_id, rep_id, claimed_by, claimed_at)
  values (p_org_id, p_order_id, p_rep_id, p_claimed_by, v_claimed_at);

  return jsonb_build_object(
    'ok', true, 'held', v_held + 1, 'cap', p_cap,
    'remaining', case when p_cap > 0 then greatest(0, p_cap - v_held - 1) else 0 end,
    'claimedAt', v_claimed_at
  );
end;
$function$;
