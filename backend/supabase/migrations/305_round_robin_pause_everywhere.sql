-- Paused from rotation = paused EVERYWHERE (Bright, 19 Oct 2026).
--
-- "Temporarily Excluded" (users.round_robin_excluded) only kept a rep out of
-- the main rotation and the cart hand-out. The Dedicated Products picker
-- checked users.active alone, so Chidinma kept getting ~6 dedicated orders a
-- day after she was paused. Bright: a paused rep receives no automatic
-- orders anywhere, and when switched back on she returns to the SAME turn -
-- no move to the back of the line, no catch-up burst.
--
-- 1. users.round_robin_paused_rank: how many active reps were ahead of her in
--    the main line when she was paused. The server puts her back at that
--    place on re-enable (routes/auth.ts).
-- 2. product_dedicated_handlers.rejoin_credit (+ _day): the dedicated split
--    is "today's orders ÷ weight", so someone returning mid-day would win the
--    next several orders in a row. On re-enable she is credited with the
--    orders she would have had at the lowest current share, for that day
--    only, so she rejoins level instead of catching up.
-- 3. The picker skips paused reps and counts the credit.

alter table users
  add column if not exists round_robin_paused_rank integer;

alter table product_dedicated_handlers
  add column if not exists rejoin_credit numeric not null default 0,
  add column if not exists rejoin_credit_day date;

create or replace function pick_and_advance_dedicated_handler(p_product_id uuid, p_org_id uuid)
returns uuid
language plpgsql
as $$
declare
  picked uuid;
  today_start timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  today_day date := (now() at time zone 'Africa/Lagos')::date;
begin
  select pdh.user_id into picked
  from product_dedicated_handlers pdh
  join users u on u.id = pdh.user_id
  where pdh.product_id = p_product_id
    and pdh.weight > 0
    and u.org_id = p_org_id
    and u.active = true
    and coalesce(u.round_robin_excluded, false) = false
  order by (
    (coalesce((
      select count(*)
      from orders o
      where o.assigned_rep_id = pdh.user_id
        and o.product_id = p_product_id
        and o.created_at >= today_start
    ), 0)
    + case when pdh.rejoin_credit_day = today_day then pdh.rejoin_credit else 0 end
    )::numeric / pdh.weight
  ) asc,
           pdh.last_assigned_at asc nulls first,
           pdh.user_id asc
  limit 1
  for update of pdh;

  if picked is null then
    return null;
  end if;

  update product_dedicated_handlers
  set assigned_count = assigned_count + 1,
      last_assigned_at = now()
  where product_id = p_product_id and user_id = picked;

  return picked;
end;
$$;

-- Called when a rep is switched back on. For every product she handles, give
-- her today's credit so her share equals the lowest share among the other
-- eligible handlers, and mark her as just served so a tie goes to the others.
create or replace function rejoin_dedicated_handler(p_user_id uuid, p_org_id uuid)
returns void
language plpgsql
as $$
declare
  today_start timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  today_day date := (now() at time zone 'Africa/Lagos')::date;
  h record;
  lowest numeric;
  mine numeric;
begin
  for h in
    select pdh.product_id, pdh.weight
    from product_dedicated_handlers pdh
    join users me on me.id = pdh.user_id
    where pdh.user_id = p_user_id and me.org_id = p_org_id and pdh.weight > 0
  loop
    select min((
      coalesce((select count(*) from orders o
        where o.assigned_rep_id = other.user_id and o.product_id = h.product_id and o.created_at >= today_start), 0)
      + case when other.rejoin_credit_day = today_day then other.rejoin_credit else 0 end
    )::numeric / other.weight) into lowest
    from product_dedicated_handlers other
    join users u on u.id = other.user_id
    where other.product_id = h.product_id
      and other.user_id <> p_user_id
      and other.weight > 0
      and u.org_id = p_org_id
      and u.active = true
      and coalesce(u.round_robin_excluded, false) = false;

    select count(*) into mine from orders o
    where o.assigned_rep_id = p_user_id and o.product_id = h.product_id and o.created_at >= today_start;

    update product_dedicated_handlers
    set rejoin_credit = greatest(0, coalesce(lowest, 0) * h.weight - mine),
        rejoin_credit_day = today_day,
        last_assigned_at = now()
    where product_id = h.product_id and user_id = p_user_id;
  end loop;
end;
$$;
