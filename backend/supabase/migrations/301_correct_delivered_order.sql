-- Correct a DELIVERED order in place: its agent, hub, product or quantity
-- (Bright, 12 Oct 2026).
--
-- "Once an order is delivered and needs changes, allow Admin, Manager and
-- Owner to make them without putting it to Failed Delivery - in case the sales
-- rep put the wrong agent or didn't make corrections."
--
-- Until now those four fields were refused once the stock had been closed,
-- and the only way round was Delivered -> Failed -> Delivered: a false Failed
-- in the order's history, the waybill record deleted, and (see migration 300)
-- stock that was never put back.
--
-- This function does the whole correction in ONE transaction:
--   1. Every stock line that changes and was already closed by the inventory
--      officer is put back on the hub it came off.
--   2. The order's stock lines are rewritten for the corrected agent, hub,
--      products and quantities, and go back on the officer's list as PENDING -
--      the same place a fresh delivery starts. Stock comes off the right hub
--      when the officer closes it, exactly as for any delivery. A line that
--      did not change is left alone, closed or not.
--   3. The right hub must have the stock: what it holds, less what is already
--      promised to other delivered orders. Short stock refuses the whole
--      correction (Bright's choice), and nothing is changed.
--   4. The order row itself is updated in the same transaction, so the order
--      and its stock lines can never disagree.
--   5. Cash already recorded for the order follows it to the right agent
--      (Bright's choice: the right agent delivered and paid; the order just
--      carried the wrong name).
--
-- The order stays Delivered throughout: status is never touched, so the
-- delivery trigger does not fire and no Failed appears in its history.
--
-- Additive: one new function. Nothing existing is altered.

create or replace function public.correct_delivered_order(
  p_org_id uuid,
  p_order_id text,
  p_order_patch jsonb,
  p_lines jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_agent_id uuid;
  v_location_id uuid;
  v_agent_name text;
  v_state text;
  v_customer text;
  v_actor text := coalesce(nullif(trim(p_actor_name), ''), 'a manager');
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_reversal_type text;
  v_note_prefix text := '';
  v_old record;
  v_target record;
  v_payload jsonb := '[]'::jsonb;
  v_done uuid[] := '{}';
  v_set text;
  v_physical integer;
  v_reserved integer;
  v_restored integer := 0;
  v_requeued integer := 0;
  v_removed integer := 0;
  v_unchanged integer := 0;
  v_agent_changed boolean;
  v_has_target boolean;
  v_targets jsonb;
  v_result public.orders%rowtype;
begin
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'INVALID_INVENTORY|Say why this delivered order is being corrected.';
  end if;
  if p_order_patch is null or jsonb_typeof(p_order_patch) <> 'object' then
    raise exception 'INVALID_INVENTORY|Nothing to correct.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVALID_INVENTORY|A delivered order needs at least one product.';
  end if;
  if jsonb_array_length(p_lines) > 60 then
    raise exception 'INVALID_INVENTORY|Too many product lines on one order.';
  end if;

  select * into v_order from public.orders
  where org_id = p_org_id and id = p_order_id
  for update;
  if not found then
    raise exception 'INVENTORY_CONFLICT|Order not found.';
  end if;
  if v_order.status::text <> 'Delivered' then
    raise exception 'INVENTORY_CONFLICT|This order is no longer Delivered. Refresh and try again.';
  end if;

  -- The agent and hub the order should carry after the correction.
  if p_order_patch ? 'agent_id' then
    v_agent_id := nullif(p_order_patch->>'agent_id', '')::uuid;
  else
    v_agent_id := v_order.agent_id;
  end if;
  if p_order_patch ? 'agent_location_id' then
    v_location_id := nullif(p_order_patch->>'agent_location_id', '')::uuid;
  else
    v_location_id := v_order.agent_location_id;
  end if;
  if v_agent_id is null or v_location_id is null then
    raise exception 'INVALID_INVENTORY|A delivered order needs an agent and a stock hub.';
  end if;
  perform 1 from public.agent_locations
  where id = v_location_id and agent_id = v_agent_id and org_id = p_org_id;
  if not found then
    raise exception 'INVALID_INVENTORY|That stock hub does not belong to the chosen agent.';
  end if;
  v_agent_changed := v_agent_id is distinct from v_order.agent_id;

  v_agent_name := coalesce(nullif(p_order_patch->>'agent_name_snapshot', ''), (select name from public.agents where id = v_agent_id), '');
  v_state := coalesce(nullif(p_order_patch->>'agent_location_state_snapshot', ''),
                      (select state from public.agent_locations where id = v_location_id),
                      nullif(p_order_patch->>'state', ''), v_order.state, '');
  v_customer := coalesce(nullif(p_order_patch->>'customer', ''), v_order.customer, '');

  -- An order delivered before the officer's list existed (7 Sept 2026) had its
  -- stock taken off by the old method and has no lines to work from.
  if not exists (
    select 1 from public.delivered_stock_reconciliation_lines
    where org_id = p_org_id and order_id = p_order_id
  ) then
    raise exception 'INVENTORY_CONFLICT|This order was delivered before stock was tracked per delivery, so its agent, product and quantity cannot be corrected here. Correct the stock with a stock adjustment.';
  end if;

  -- The put-back movement type. Migration 300 adds 'Status Reversal'; if a
  -- database does not have it yet, fall back to the long-standing form the app
  -- already reads as a reversal: a Correction whose note starts with the name.
  if exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'stock_movement_type' and e.enumlabel = 'Status Reversal'
  ) then
    v_reversal_type := 'Status Reversal';
  else
    v_reversal_type := 'Correction';
    v_note_prefix := 'Status Reversal: ';
  end if;

  -- What the order needs after the correction: one row per product.
  select coalesce(jsonb_agg(jsonb_build_object('product_id', x.product_id, 'product_name', x.product_name, 'quantity', x.quantity) order by x.product_id), '[]'::jsonb)
  into v_targets
  from (
    select nullif(value->>'productId', '')::uuid as product_id,
           max(nullif(value->>'productName', '')) as product_name,
           sum((value->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_lines)
    group by 1
  ) x;
  if exists (
    select 1 from jsonb_to_recordset(v_targets) as t(product_id uuid, product_name text, quantity integer)
    where t.product_id is null or t.quantity is null or t.quantity <= 0
  ) then
    raise exception 'INVALID_INVENTORY|Every product line needs a product and a quantity above zero.';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_targets) as t(product_id uuid, product_name text, quantity integer)
    left join public.products p on p.id = t.product_id and p.org_id = p_org_id
    where p.id is null
  ) then
    raise exception 'INVALID_INVENTORY|A product on this order does not belong to this organization.';
  end if;

  -- 1. Existing lines: leave the unchanged, put back the closed ones that change.
  for v_old in
    select * from public.delivered_stock_reconciliation_lines
    where org_id = p_org_id and order_id = p_order_id
      and status in ('pending', 'exception', 'reconciled')
    order by product_id, id
    for update
  loop
    select * into v_target
    from jsonb_to_recordset(v_targets) as t(product_id uuid, product_name text, quantity integer)
    where t.product_id = v_old.product_id;
    v_has_target := found;
    if v_has_target and v_old.agent_location_id = v_location_id and v_old.quantity = v_target.quantity then
      update public.delivered_stock_reconciliation_lines
      set agent_name_snapshot = v_agent_name,
          customer_snapshot = v_customer,
          product_name_snapshot = coalesce(v_target.product_name, product_name_snapshot),
          updated_at = now()
      where id = v_old.id;
      v_done := v_done || v_old.product_id;
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    if v_old.status = 'reconciled' then
      v_payload := v_payload || jsonb_build_array(jsonb_build_object(
        'movementId', 'MOV-DC-' || replace(v_old.id::text, '-', '') || '-C' || v_old.delivery_cycle::text,
        'idempotencyKey', 'delivered-correction:' || v_old.id::text || ':cycle:' || v_old.delivery_cycle::text,
        'productId', v_old.product_id,
        'productName', v_old.product_name_snapshot,
        'type', v_reversal_type,
        'quantity', v_old.quantity,
        'destinationScope', 'agent_location',
        'destinationAgentLocationId', v_old.agent_location_id,
        'agentId', v_old.agent_id,
        'orderId', p_order_id,
        'fromLocation', 'Customer:' || p_order_id,
        'toLocation', v_old.agent_name_snapshot || case when v_old.state_snapshot <> '' then ' - ' || v_old.state_snapshot else '' end,
        'note', left(v_note_prefix || 'Delivered order ' || p_order_id || ' corrected by ' || v_actor || ' - put back. Reason: ' || v_reason, 500)
      ));
      v_restored := v_restored + v_old.quantity;
    end if;

    if not v_has_target then
      -- The product is no longer on the order at all.
      update public.delivered_stock_reconciliation_lines
      set status = case when v_old.status = 'reconciled' then 'reversed' else 'voided' end,
          updated_at = now()
      where id = v_old.id;
      v_removed := v_removed + 1;
    end if;
  end loop;

  if jsonb_array_length(v_payload) > 0 then
    perform public.apply_inventory_movements(p_org_id, v_payload, p_actor_user_id, p_actor_name);
  end if;

  -- 2. Lines that are new or changed: the right hub must hold the stock, then
  --    they go on the officer's list as pending.
  for v_target in
    select * from jsonb_to_recordset(v_targets) as t(product_id uuid, product_name text, quantity integer)
    where not (t.product_id = any(v_done))
    order by t.product_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'delivered-stock:' || v_location_id::text || ':' || v_target.product_id::text, 0
    ));
    select greatest(0, quantity - defective - missing) into v_physical
    from public.agent_location_stock
    where agent_location_id = v_location_id and product_id = v_target.product_id
    for update;
    v_physical := coalesce(v_physical, 0);
    select coalesce(sum(quantity), 0) into v_reserved
    from public.delivered_stock_reconciliation_lines
    where org_id = p_org_id and agent_location_id = v_location_id
      and product_id = v_target.product_id and status in ('pending', 'exception')
      and order_id <> p_order_id;
    if v_physical - v_reserved < v_target.quantity then
      raise exception 'INSUFFICIENT_STOCK|% has only % unit(s) of % available after other deliveries; this order needs %. Nothing was changed.',
        coalesce(nullif(v_agent_name, ''), 'That agent'),
        greatest(0, v_physical - v_reserved),
        coalesce(v_target.product_name, v_target.product_id::text),
        v_target.quantity;
    end if;

    insert into public.delivered_stock_reconciliation_lines (
      org_id, order_id, agent_id, agent_location_id, state_snapshot,
      agent_name_snapshot, customer_snapshot, product_id,
      product_name_snapshot, quantity, status, delivered_at
    ) values (
      p_org_id, p_order_id, v_agent_id, v_location_id, v_state,
      v_agent_name, v_customer, v_target.product_id,
      coalesce(v_target.product_name, v_target.product_id::text), v_target.quantity, 'pending', now()
    )
    on conflict (org_id, order_id, product_id) do update set
      agent_id = excluded.agent_id,
      agent_location_id = excluded.agent_location_id,
      state_snapshot = excluded.state_snapshot,
      agent_name_snapshot = excluded.agent_name_snapshot,
      customer_snapshot = excluded.customer_snapshot,
      product_name_snapshot = excluded.product_name_snapshot,
      quantity = excluded.quantity,
      status = 'pending',
      delivery_cycle = public.delivered_stock_reconciliation_lines.delivery_cycle + 1,
      delivered_at = excluded.delivered_at,
      reconciled_at = null,
      reconciled_by = null,
      reconciled_by_name = null,
      movement_id = null,
      issue_note = left('Corrected by ' || v_actor || ': ' || v_reason, 300),
      updated_at = now();
    v_requeued := v_requeued + 1;
  end loop;

  -- 3. The order row, in the same transaction. Only real columns of orders are
  --    taken from the patch, and never the ones this function owns.
  select string_agg(format('%I = r.%I', c.column_name, c.column_name), ', ')
  into v_set
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'orders'
    and p_order_patch ? c.column_name
    and c.column_name not in (
      'id', 'org_id', 'branch_id', 'status', 'created_at',
      'stock_deducted', 'stock_reconciliation_status', 'stock_reconciliation_lines_snapshot',
      'stock_reconciled_at', 'stock_reconciled_by'
    );
  if v_set is not null then
    execute format(
      'update public.orders o set %s from jsonb_populate_record(null::public.orders, $1) r where o.org_id = $2 and o.id = $3',
      v_set
    ) using p_order_patch, p_org_id, p_order_id;
  end if;

  update public.orders o
  set agent_id = v_agent_id,
      agent_location_id = v_location_id,
      stock_reconciliation_lines_snapshot = (
        select coalesce(jsonb_agg(jsonb_build_object('productId', t.product_id, 'productName', t.product_name, 'quantity', t.quantity) order by t.product_id), '[]'::jsonb)
        from jsonb_to_recordset(v_targets) as t(product_id uuid, product_name text, quantity integer)
      ),
      stock_deducted = not exists (
        select 1 from public.delivered_stock_reconciliation_lines l
        where l.org_id = o.org_id and l.order_id = o.id and l.status in ('pending', 'exception')
      ),
      stock_reconciliation_status = case
        when exists (select 1 from public.delivered_stock_reconciliation_lines l where l.org_id = o.org_id and l.order_id = o.id and l.status = 'exception') then 'exception'
        when exists (select 1 from public.delivered_stock_reconciliation_lines l where l.org_id = o.org_id and l.order_id = o.id and l.status = 'pending')
          and exists (select 1 from public.delivered_stock_reconciliation_lines l where l.org_id = o.org_id and l.order_id = o.id and l.status = 'reconciled') then 'partial'
        when exists (select 1 from public.delivered_stock_reconciliation_lines l where l.org_id = o.org_id and l.order_id = o.id and l.status = 'pending') then 'pending'
        else 'reconciled'
      end
  where o.org_id = p_org_id and o.id = p_order_id;

  update public.orders o
  set stock_reconciled_at = case when o.stock_deducted then coalesce(o.stock_reconciled_at, now()) else null end,
      stock_reconciled_by = case when o.stock_deducted then o.stock_reconciled_by else null end
  where o.org_id = p_org_id and o.id = p_order_id;

  -- 4. Cash already recorded for this order follows it to the right agent.
  if v_agent_changed then
    update public.remittance_transactions
    set agent_id_snapshot = v_agent_id
    where org_id = p_org_id and order_id = p_order_id
      and agent_id_snapshot is distinct from v_agent_id;
  end if;

  select * into v_result from public.orders where org_id = p_org_id and id = p_order_id;
  return jsonb_build_object(
    'order', to_jsonb(v_result),
    'agentChanged', v_agent_changed,
    'previousAgentId', v_order.agent_id,
    'unitsPutBack', v_restored,
    'linesToVerify', v_requeued,
    'linesRemoved', v_removed,
    'linesUnchanged', v_unchanged
  );
end;
$$;

revoke all on function public.correct_delivered_order(uuid, text, jsonb, jsonb, uuid, text, text) from public;
revoke all on function public.correct_delivered_order(uuid, text, jsonb, jsonb, uuid, text, text) from anon, authenticated;
grant execute on function public.correct_delivered_order(uuid, text, jsonb, jsonb, uuid, text, text) to service_role;
