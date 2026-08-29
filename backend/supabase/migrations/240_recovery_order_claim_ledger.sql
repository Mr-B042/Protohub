-- Immutable Recovery Rep claim history. orders.assigned_rep_id/assigned_at describe
-- only the current owner, so they cannot be used as a historical claim ledger.
create table if not exists public.recovery_order_claims (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  order_id    text not null references public.orders(id) on delete cascade,
  rep_id      uuid not null references public.users(id) on delete cascade,
  claimed_by  uuid references public.users(id) on delete set null,
  claimed_at  timestamptz not null default now()
);

create index if not exists recovery_order_claims_rep_day_idx
  on public.recovery_order_claims (org_id, rep_id, claimed_at desc);
create unique index if not exists recovery_order_claims_event_uq
  on public.recovery_order_claims (org_id, order_id, rep_id, claimed_at);

alter table public.recovery_order_claims enable row level security;
create policy "Org members read recovery claims"
  on public.recovery_order_claims for select
  using (org_id = private.auth_org_id());
create policy "Service role manages recovery claims"
  on public.recovery_order_claims for all
  using ((select auth.role()) = 'service_role')
  with check ((select auth.role()) = 'service_role');

-- Recover assignment events already captured by the generic field audit.
insert into public.recovery_order_claims (org_id, order_id, rep_id, claimed_by, claimed_at)
select e.org_id, e.order_id,
  case when (e.to_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (e.to_value #>> '{}')::uuid end,
  e.changed_by, e.created_at
from public.order_field_edits e
join public.users u on u.id = case
  when (e.to_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then (e.to_value #>> '{}')::uuid end
where e.field_name = 'assigned_rep_id'
  and (e.to_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and u.org_id = e.org_id
  and u.role = 'Recovery Rep'
on conflict do nothing;

-- Backfill current claims that predate (or bypassed) the field audit.
insert into public.recovery_order_claims (org_id, order_id, rep_id, claimed_by, claimed_at)
select o.org_id, o.id, o.assigned_rep_id, o.assigned_by_user_id, o.assigned_at
from public.orders o
join public.users u on u.id = o.assigned_rep_id and u.org_id = o.org_id
where o.assigned_at is not null and u.role = 'Recovery Rep'
  and not exists (
    select 1 from public.recovery_order_claims c
    where c.org_id = o.org_id and c.order_id = o.id and c.rep_id = o.assigned_rep_id
  );

-- Claim, cap check, order reassignment and ledger insert are one transaction.
-- Locks are per rep plus per order, preventing rapid parallel clicks from
-- exceeding the cap or letting two reps both successfully claim one order.
create or replace function public.claim_recovery_order(
  p_org_id uuid,
  p_order_id text,
  p_rep_id uuid,
  p_claimed_by uuid,
  p_cap integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  if p_cap <= 0 then raise exception 'Claiming is switched off. Set an open-order limit in Recovery settings.'; end if;
  if v_held >= p_cap then
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
    'remaining', greatest(0, p_cap - v_held - 1), 'claimedAt', v_claimed_at
  );
end;
$$;

revoke all on function public.claim_recovery_order(uuid, text, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_recovery_order(uuid, text, uuid, uuid, integer) to service_role;
notify pgrst, 'reload schema';
