-- A reconciliation line can be delivered again in a later cycle. The old
-- function used only the line UUID for movement_id, so cycle 2 reused cycle 1's
-- primary key even though its idempotency key was different. Keep the
-- idempotency key and ledger ID aligned with the cycle.

create or replace function public.reconcile_delivered_stock(
  p_org_id uuid,
  p_line_ids uuid[],
  p_actor_user_id uuid default null,
  p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested integer;
  v_locked integer;
  v_payload jsonb;
  v_results jsonb;
begin
  v_requested := coalesce(array_length(p_line_ids, 1), 0);
  if v_requested = 0 or v_requested > 100 then
    raise exception 'INVALID_INVENTORY|Select between 1 and 100 delivered stock lines.';
  end if;
  if v_requested <> (select count(distinct id) from unnest(p_line_ids) id) then
    raise exception 'INVALID_INVENTORY|A delivered stock line was selected more than once.';
  end if;

  perform 1 from public.delivered_stock_reconciliation_lines
  where org_id = p_org_id and id = any(p_line_ids)
  order by product_id, id
  for update;

  select count(*) into v_locked
  from public.delivered_stock_reconciliation_lines
  where org_id = p_org_id and id = any(p_line_ids) and status = 'pending';
  if v_locked <> v_requested then
    raise exception 'INVENTORY_CONFLICT|One or more delivered orders were already reconciled, flagged, or changed. Refresh and try again.';
  end if;
  if exists (
    select 1
    from public.delivered_stock_reconciliation_lines l
    left join public.orders o on o.org_id = l.org_id and o.id = l.order_id
    where l.org_id = p_org_id and l.id = any(p_line_ids)
      and coalesce(o.status::text, '') <> 'Delivered'
  ) then
    raise exception 'INVENTORY_CONFLICT|One or more selected orders are no longer Delivered.';
  end if;

  select jsonb_agg(jsonb_build_object(
    'movementId', 'MOV-DR-' || replace(l.id::text, '-', '') || '-C' || l.delivery_cycle::text,
    'idempotencyKey', 'delivered-stock:' || l.id::text || ':cycle:' || l.delivery_cycle::text,
    'productId', l.product_id,
    'productName', l.product_name_snapshot,
    'type', 'Order Fulfilled',
    'quantity', l.quantity,
    'sourceScope', 'agent_location',
    'sourceAgentLocationId', l.agent_location_id,
    'agentId', l.agent_id,
    'orderId', l.order_id,
    'fromLocation', l.agent_name_snapshot || case when l.state_snapshot <> '' then ' - ' || l.state_snapshot else '' end,
    'toLocation', 'Customer:' || l.order_id,
    'note', 'Delivered stock reconciled by ' || coalesce(p_actor_name, 'Inventory Officer')
  ) order by l.product_id, l.id)
  into v_payload
  from public.delivered_stock_reconciliation_lines l
  where l.org_id = p_org_id and l.id = any(p_line_ids);

  v_results := public.apply_inventory_movements(p_org_id, v_payload, p_actor_user_id, p_actor_name);

  update public.delivered_stock_reconciliation_lines l
  set status = 'reconciled',
      reconciled_at = now(),
      reconciled_by = p_actor_user_id,
      reconciled_by_name = p_actor_name,
      movement_id = 'MOV-DR-' || replace(l.id::text, '-', '') || '-C' || l.delivery_cycle::text,
      issue_note = null,
      updated_at = now()
  where l.org_id = p_org_id and l.id = any(p_line_ids);

  update public.orders o
  set stock_deducted = not exists (
        select 1 from public.delivered_stock_reconciliation_lines l
        where l.org_id = o.org_id and l.order_id = o.id and l.status in ('pending','exception')
      ),
      stock_reconciliation_status = case
        when exists (select 1 from public.delivered_stock_reconciliation_lines l where l.org_id=o.org_id and l.order_id=o.id and l.status='exception') then 'exception'
        when exists (select 1 from public.delivered_stock_reconciliation_lines l where l.org_id=o.org_id and l.order_id=o.id and l.status='pending')
          and exists (select 1 from public.delivered_stock_reconciliation_lines l where l.org_id=o.org_id and l.order_id=o.id and l.status='reconciled') then 'partial'
        when exists (select 1 from public.delivered_stock_reconciliation_lines l where l.org_id=o.org_id and l.order_id=o.id and l.status='pending') then 'pending'
        else 'reconciled'
      end,
      stock_reconciled_at = case when not exists (
        select 1 from public.delivered_stock_reconciliation_lines l
        where l.org_id=o.org_id and l.order_id=o.id and l.status in ('pending','exception')
      ) then now() else null end,
      stock_reconciled_by = case when not exists (
        select 1 from public.delivered_stock_reconciliation_lines l
        where l.org_id=o.org_id and l.order_id=o.id and l.status in ('pending','exception')
      ) then p_actor_user_id else null end
  where o.org_id = p_org_id
    and o.id in (select distinct order_id from public.delivered_stock_reconciliation_lines where org_id=p_org_id and id=any(p_line_ids));

  return jsonb_build_object('reconciledLines', v_requested, 'movements', v_results);
end;
$$;

revoke all on function public.reconcile_delivered_stock(uuid, uuid[], uuid, text) from public;
revoke all on function public.reconcile_delivered_stock(uuid, uuid[], uuid, text) from anon, authenticated;
grant execute on function public.reconcile_delivered_stock(uuid, uuid[], uuid, text) to service_role;
