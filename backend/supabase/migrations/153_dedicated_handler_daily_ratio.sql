-- Rescope the weighted dedicated-handler picker's ratio from a lifetime
-- cumulative count to a same-day count, so a weight of 100/100/100 means
-- an even split for THAT DAY (not a slow lifetime catch-up that can leave
-- a rep at zero for days/weeks once another rep's lifetime count falls far
-- behind). 100/100/60/40 now proportions today's orders, resetting itself
-- automatically at midnight (Africa/Lagos) with no manual "Reset counts"
-- click required.
--
-- assigned_count/last_assigned_at are still updated for historical/lifetime
-- reporting value, but are no longer read by the picker itself.
create or replace function pick_and_advance_dedicated_handler(p_product_id uuid, p_org_id uuid)
returns uuid
language plpgsql
as $$
declare
  picked uuid;
  today_start timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
begin
  select pdh.user_id into picked
  from product_dedicated_handlers pdh
  join users u on u.id = pdh.user_id
  where pdh.product_id = p_product_id
    and pdh.weight > 0
    and u.org_id = p_org_id
    and u.active = true
  order by (
    coalesce((
      select count(*)
      from orders o
      where o.assigned_rep_id = pdh.user_id
        and o.product_id = p_product_id
        and o.created_at >= today_start
    ), 0)::numeric / pdh.weight
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

grant execute on function pick_and_advance_dedicated_handler(uuid, uuid) to service_role;
