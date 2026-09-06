-- Inventory quantities and their ledger entries must be one database fact.
--
-- Before this migration, the API changed products.warehouse_stock or
-- agent_location_stock and inserted stock_movements with a second PostgREST
-- request. A timeout, process restart, duplicate click, or concurrent request
-- could commit one write without the other. This migration adds one batch RPC:
-- every affected row is locked, every line is validated, balances and ledger
-- rows are written in the same transaction, and retries are idempotent.

alter table public.stock_movements
  add column if not exists idempotency_key text,
  add column if not exists source_scope text,
  add column if not exists destination_scope text,
  add column if not exists source_balance_after integer,
  add column if not exists destination_balance_after integer;

create unique index if not exists stock_movements_org_idempotency_key_uidx
  on public.stock_movements (org_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists stock_movements_atomic_scope_idx
  on public.stock_movements (org_id, product_id, created_at)
  where idempotency_key is not null;

alter table public.stock_count_entries
  add column if not exists agent_location_id uuid references public.agent_locations(id) on delete set null,
  add column if not exists agent_location_name text;

create table if not exists public.inventory_balance_baselines (
  scope_key         text primary key,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  scope             text not null check (scope in ('warehouse', 'agent_location')),
  product_id        uuid not null references public.products(id) on delete cascade,
  agent_location_id uuid references public.agent_locations(id) on delete cascade,
  quantity          integer not null check (quantity >= 0),
  established_at    timestamptz not null default now(),
  check ((scope = 'warehouse' and agent_location_id is null)
      or (scope = 'agent_location' and agent_location_id is not null))
);

comment on table public.inventory_balance_baselines is
  'Opening balance at installation of the atomic inventory ledger. New movement rows replay from this point, so any future drift is exact and immediately detectable.';

insert into public.inventory_balance_baselines (scope_key, org_id, scope, product_id, quantity)
select 'warehouse:' || p.id::text, p.org_id, 'warehouse', p.id, p.warehouse_stock
from public.products p
on conflict (scope_key) do nothing;

insert into public.inventory_balance_baselines
  (scope_key, org_id, scope, product_id, agent_location_id, quantity)
select 'agent_location:' || als.agent_location_id::text || ':' || als.product_id::text,
       als.org_id, 'agent_location', als.product_id, als.agent_location_id, als.quantity
from public.agent_location_stock als
on conflict (scope_key) do nothing;

create or replace function public.sync_inventory_aggregates(
  p_org_id uuid,
  p_agent_id uuid,
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity integer;
  v_defective integer;
  v_missing integer;
  v_product_total integer;
begin
  perform set_config('app.inventory_atomic_writer', '1', true);

  select coalesce(sum(quantity), 0)::integer,
         coalesce(sum(defective), 0)::integer,
         coalesce(sum(missing), 0)::integer
    into v_quantity, v_defective, v_missing
  from public.agent_location_stock
  where org_id = p_org_id and agent_id = p_agent_id and product_id = p_product_id;

  if v_quantity = 0 and v_defective = 0 and v_missing = 0 then
    delete from public.agent_stock
    where agent_id = p_agent_id and product_id = p_product_id;
  else
    insert into public.agent_stock (agent_id, product_id, quantity, defective, missing)
    values (p_agent_id, p_product_id, v_quantity, v_defective, v_missing)
    on conflict (agent_id, product_id) do update set
      quantity = excluded.quantity,
      defective = excluded.defective,
      missing = excluded.missing;
  end if;

  select coalesce(sum(s.quantity), 0)::integer into v_product_total
  from public.agent_location_stock s
  where s.org_id = p_org_id and s.product_id = p_product_id;

  update public.products
  set agent_stock = v_product_total
  where id = p_product_id and org_id = p_org_id;
end;
$$;

create or replace function public.apply_inventory_movements(
  p_org_id uuid,
  p_lines jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_results jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_product_name text;
  v_type public.stock_movement_type;
  v_quantity integer;
  v_ledger_quantity integer;
  v_source_scope text;
  v_destination_scope text;
  v_source_location_id uuid;
  v_destination_location_id uuid;
  v_bucket_location_id uuid;
  v_defective_delta integer;
  v_missing_delta integer;
  v_source_agent_id uuid;
  v_destination_agent_id uuid;
  v_source_before integer;
  v_source_after integer;
  v_destination_before integer;
  v_destination_after integer;
  v_movement_id text;
  v_idempotency_key text;
  v_existing_id text;
  v_balance_after integer;
  v_agent_id uuid;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVALID_INVENTORY|At least one inventory movement is required.';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'INVALID_INVENTORY|A single inventory operation cannot exceed 100 product lines.';
  end if;

  perform set_config('app.inventory_atomic_writer', '1', true);
  perform set_config('app.actor', coalesce(p_actor_name, p_actor_user_id::text, 'system'), true);

  -- Product order is deterministic so concurrent multi-product batches cannot
  -- deadlock by taking the same product locks in opposite orders.
  for v_line in
    select value from jsonb_array_elements(p_lines)
    order by value->>'productId', value->>'idempotencyKey'
  loop
    v_product_id := (v_line->>'productId')::uuid;
    v_movement_id := nullif(v_line->>'movementId', '');
    v_idempotency_key := nullif(v_line->>'idempotencyKey', '');
    v_quantity := (v_line->>'quantity')::integer;
    v_ledger_quantity := coalesce((v_line->>'ledgerQuantity')::integer, v_quantity);
    v_source_scope := nullif(v_line->>'sourceScope', '');
    v_destination_scope := nullif(v_line->>'destinationScope', '');
    v_source_location_id := nullif(v_line->>'sourceAgentLocationId', '')::uuid;
    v_destination_location_id := nullif(v_line->>'destinationAgentLocationId', '')::uuid;
    v_bucket_location_id := nullif(v_line->>'bucketAgentLocationId', '')::uuid;
    v_defective_delta := coalesce((v_line->>'defectiveDelta')::integer, 0);
    v_missing_delta := coalesce((v_line->>'missingDelta')::integer, 0);
    v_agent_id := nullif(v_line->>'agentId', '')::uuid;

    if v_movement_id is null or v_idempotency_key is null or v_quantity <= 0 then
      raise exception 'INVALID_INVENTORY|Movement id, retry key, and a positive quantity are required.';
    end if;
    if v_source_scope is null and v_destination_scope is null then
      raise exception 'INVALID_INVENTORY|Every movement needs a source or destination.';
    end if;
    if coalesce(v_source_scope, '') not in ('', 'warehouse', 'agent_location')
       or coalesce(v_destination_scope, '') not in ('', 'warehouse', 'agent_location') then
      raise exception 'INVALID_INVENTORY|Unknown inventory scope.';
    end if;
    if v_source_scope = 'agent_location' and v_source_location_id is null then
      raise exception 'INVALID_INVENTORY|Source hub is required.';
    end if;
    if v_destination_scope = 'agent_location' and v_destination_location_id is null then
      raise exception 'INVALID_INVENTORY|Destination hub is required.';
    end if;
    if v_source_scope = v_destination_scope
       and (v_source_scope = 'warehouse'
         or v_source_location_id is not distinct from v_destination_location_id) then
      raise exception 'INVALID_INVENTORY|Source and destination must be different.';
    end if;

    select p.name into v_product_name
    from public.products p
    where p.id = v_product_id and p.org_id = p_org_id
    for update;
    if not found then
      raise exception 'INVALID_INVENTORY|Product does not belong to this organization.';
    end if;

    -- Check idempotency only after taking the product lock. Two concurrent
    -- retries therefore serialize here; the second sees the first one's row
    -- instead of colliding on the unique index after changing stock.
    select id, source_balance_after, destination_balance_after
      into v_existing_id, v_source_after, v_destination_after
    from public.stock_movements
    where org_id = p_org_id and idempotency_key = v_idempotency_key;
    if found then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'movementId', v_existing_id,
        'idempotencyKey', v_idempotency_key,
        'duplicate', true,
        'sourceBalanceAfter', v_source_after,
        'destinationBalanceAfter', v_destination_after
      ));
      continue;
    end if;

    v_product_name := coalesce(nullif(v_line->>'productName', ''), v_product_name);
    v_type := (v_line->>'type')::public.stock_movement_type;
    v_source_before := null; v_source_after := null;
    v_destination_before := null; v_destination_after := null;
    v_source_agent_id := null; v_destination_agent_id := null;

    if v_source_scope = 'warehouse' then
      select warehouse_stock into v_source_before
      from public.products where id = v_product_id and org_id = p_org_id;
      if v_source_before < v_quantity then
        raise exception 'INSUFFICIENT_STOCK|Warehouse has % unit(s) of %, but % are required.',
          v_source_before, v_product_name, v_quantity;
      end if;
      insert into public.inventory_balance_baselines (scope_key, org_id, scope, product_id, quantity)
      values ('warehouse:' || v_product_id::text, p_org_id, 'warehouse', v_product_id, v_source_before)
      on conflict (scope_key) do nothing;
      v_source_after := v_source_before - v_quantity;
      update public.products set warehouse_stock = v_source_after
      where id = v_product_id and org_id = p_org_id;
    elsif v_source_scope = 'agent_location' then
      select l.agent_id into v_source_agent_id
      from public.agent_locations l
      where l.id = v_source_location_id and l.org_id = p_org_id;
      if not found then raise exception 'INVALID_INVENTORY|Source hub does not belong to this organization.'; end if;
      select quantity into v_source_before
      from public.agent_location_stock
      where agent_location_id = v_source_location_id and product_id = v_product_id
      for update;
      if not found then v_source_before := 0; end if;
      if v_source_before < v_quantity then
        raise exception 'INSUFFICIENT_STOCK|Hub has % unit(s) of %, but % are required.',
          v_source_before, v_product_name, v_quantity;
      end if;
      insert into public.inventory_balance_baselines
        (scope_key, org_id, scope, product_id, agent_location_id, quantity)
      values ('agent_location:' || v_source_location_id::text || ':' || v_product_id::text,
              p_org_id, 'agent_location', v_product_id, v_source_location_id, v_source_before)
      on conflict (scope_key) do nothing;
      v_source_after := v_source_before - v_quantity;
      update public.agent_location_stock
      set quantity = v_source_after
      where agent_location_id = v_source_location_id and product_id = v_product_id;
    end if;

    if v_destination_scope = 'warehouse' then
      select warehouse_stock into v_destination_before
      from public.products where id = v_product_id and org_id = p_org_id;
      insert into public.inventory_balance_baselines (scope_key, org_id, scope, product_id, quantity)
      values ('warehouse:' || v_product_id::text, p_org_id, 'warehouse', v_product_id, v_destination_before)
      on conflict (scope_key) do nothing;
      v_destination_after := v_destination_before + v_quantity;
      update public.products set warehouse_stock = v_destination_after
      where id = v_product_id and org_id = p_org_id;
    elsif v_destination_scope = 'agent_location' then
      select l.agent_id into v_destination_agent_id
      from public.agent_locations l
      where l.id = v_destination_location_id and l.org_id = p_org_id;
      if not found then raise exception 'INVALID_INVENTORY|Destination hub does not belong to this organization.'; end if;
      insert into public.agent_location_stock
        (org_id, agent_id, agent_location_id, product_id, quantity, defective, missing)
      values (p_org_id, v_destination_agent_id, v_destination_location_id, v_product_id, 0, 0, 0)
      on conflict (agent_location_id, product_id) do nothing;
      select quantity into v_destination_before
      from public.agent_location_stock
      where agent_location_id = v_destination_location_id and product_id = v_product_id
      for update;
      insert into public.inventory_balance_baselines
        (scope_key, org_id, scope, product_id, agent_location_id, quantity)
      values ('agent_location:' || v_destination_location_id::text || ':' || v_product_id::text,
              p_org_id, 'agent_location', v_product_id, v_destination_location_id, v_destination_before)
      on conflict (scope_key) do nothing;
      v_destination_after := v_destination_before + v_quantity;
      update public.agent_location_stock
      set quantity = v_destination_after
      where agent_location_id = v_destination_location_id and product_id = v_product_id;
    end if;

    if v_bucket_location_id is not null and (v_defective_delta <> 0 or v_missing_delta <> 0) then
      update public.agent_location_stock
      set defective = defective + v_defective_delta,
          missing = missing + v_missing_delta
      where agent_location_id = v_bucket_location_id
        and product_id = v_product_id
        and defective + v_defective_delta >= 0
        and missing + v_missing_delta >= 0;
      if not found then
        raise exception 'INVALID_INVENTORY|Defective or missing stock would become negative.';
      end if;
      select agent_id into v_agent_id
      from public.agent_locations where id = v_bucket_location_id and org_id = p_org_id;
    end if;

    if v_source_agent_id is not null then
      perform public.sync_inventory_aggregates(p_org_id, v_source_agent_id, v_product_id);
    end if;
    if v_destination_agent_id is not null and v_destination_agent_id is distinct from v_source_agent_id then
      perform public.sync_inventory_aggregates(p_org_id, v_destination_agent_id, v_product_id);
    end if;
    if v_agent_id is not null
       and v_agent_id is distinct from v_source_agent_id
       and v_agent_id is distinct from v_destination_agent_id then
      perform public.sync_inventory_aggregates(p_org_id, v_agent_id, v_product_id);
    end if;

    -- Keep the legacy display column meaningful while preserving explicit
    -- source/destination balances for unambiguous reconciliation.
    v_balance_after := case
      when v_destination_scope is not null and v_source_scope is null then v_destination_after
      when v_source_scope is not null and v_destination_scope is null then v_source_after
      when v_type in ('Distributed to Agent', 'Return') then v_destination_after
      else v_source_after
    end;

    insert into public.stock_movements (
      id, org_id, product_id, product_name, type, qty, balance_after,
      agent_id, order_id, by_user_id, by_name, note, waybill_id,
      from_agent_location_id, to_agent_location_id, from_location, to_location,
      idempotency_key, source_scope, destination_scope,
      source_balance_after, destination_balance_after
    ) values (
      v_movement_id, p_org_id, v_product_id, v_product_name, v_type,
      v_ledger_quantity, coalesce(v_balance_after, 0),
      coalesce(v_agent_id, v_destination_agent_id, v_source_agent_id),
      nullif(v_line->>'orderId', ''), p_actor_user_id, p_actor_name,
      nullif(v_line->>'note', ''), nullif(v_line->>'waybillId', ''),
      v_source_location_id, v_destination_location_id,
      nullif(v_line->>'fromLocation', ''), nullif(v_line->>'toLocation', ''),
      v_idempotency_key, v_source_scope, v_destination_scope,
      v_source_after, v_destination_after
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'movementId', v_movement_id,
      'idempotencyKey', v_idempotency_key,
      'duplicate', false,
      'sourceBalanceAfter', v_source_after,
      'destinationBalanceAfter', v_destination_after
    ));
  end loop;

  return v_results;
end;
$$;

revoke all on function public.apply_inventory_movements(uuid, jsonb, uuid, text) from public;
revoke all on function public.apply_inventory_movements(uuid, jsonb, uuid, text) from anon, authenticated;
grant execute on function public.apply_inventory_movements(uuid, jsonb, uuid, text) to service_role;

revoke all on function public.sync_inventory_aggregates(uuid, uuid, uuid) from public;
revoke all on function public.sync_inventory_aggregates(uuid, uuid, uuid) from anon, authenticated;
grant execute on function public.sync_inventory_aggregates(uuid, uuid, uuid) to service_role;

-- Personal-delivery-agent stock previously had the same two-request gap: its
-- six balance buckets were committed first and the ledger insert happened
-- afterward. Give that subsystem its own atomic, retry-safe writer as well.
alter table public.pda_stock_ledger
  add column if not exists idempotency_key text;

create unique index if not exists pda_stock_ledger_org_idempotency_key_uidx
  on public.pda_stock_ledger (org_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.pda_inventory_baselines (
  org_id                 uuid not null,
  agent_id               uuid not null references public.personal_delivery_agents(id) on delete cascade,
  product_id             text not null,
  available              integer not null,
  reserved               integer not null,
  out_for_delivery       integer not null,
  damaged                integer not null,
  missing                integer not null,
  awaiting_investigation integer not null,
  established_at         timestamptz not null default now(),
  primary key (agent_id, product_id)
);

insert into public.pda_inventory_baselines
  (org_id, agent_id, product_id, available, reserved, out_for_delivery,
   damaged, missing, awaiting_investigation)
select org_id, agent_id, product_id, available, reserved, out_for_delivery,
       damaged, missing, awaiting_investigation
from public.pda_agent_stock
on conflict (agent_id, product_id) do nothing;

create or replace function public.apply_pda_stock_movement(
  p_org_id uuid,
  p_agent_id uuid,
  p_product_id text,
  p_movement text,
  p_quantity integer,
  p_idempotency_key text,
  p_product_name text default null,
  p_order_id text default null,
  p_transfer_id uuid default null,
  p_note text default null,
  p_recorded_by uuid default null,
  p_recorded_by_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pda_agent_stock%rowtype;
  v_existing public.pda_stock_ledger%rowtype;
begin
  if p_quantity <= 0 or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'INVALID_PDA_INVENTORY|Quantity and retry key are required.';
  end if;
  if p_movement not in (
    'Received from company','Reserved for order','Released back to available',
    'Out for delivery','Delivered to customer','Returned to available',
    'Written off damaged','Written off missing','Under investigation',
    'Adjustment approved','Returned to company'
  ) then
    raise exception 'INVALID_PDA_INVENTORY|Unknown stock movement.';
  end if;
  if not exists (
    select 1 from public.personal_delivery_agents
    where id = p_agent_id and org_id = p_org_id
  ) then
    raise exception 'INVALID_PDA_INVENTORY|Delivery agent does not belong to this organization.';
  end if;

  perform set_config('app.pda_inventory_atomic_writer', '1', true);
  perform set_config('app.actor', coalesce(p_recorded_by_name, p_recorded_by::text, 'system'), true);

  insert into public.pda_agent_stock (org_id, agent_id, product_id)
  values (p_org_id, p_agent_id, p_product_id)
  on conflict (agent_id, product_id) do nothing;

  select * into v_row
  from public.pda_agent_stock
  where agent_id = p_agent_id and product_id = p_product_id
  for update;

  -- Serialize retries on the stock row before checking the unique ledger key.
  select * into v_existing
  from public.pda_stock_ledger
  where org_id = p_org_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'duplicate', true,
      'available', v_row.available,
      'reserved', v_row.reserved,
      'outForDelivery', v_row.out_for_delivery,
      'damaged', v_row.damaged,
      'missing', v_row.missing,
      'awaitingInvestigation', v_row.awaiting_investigation
    );
  end if;

  insert into public.pda_inventory_baselines
    (org_id, agent_id, product_id, available, reserved, out_for_delivery,
     damaged, missing, awaiting_investigation)
  values
    (p_org_id, p_agent_id, p_product_id, v_row.available, v_row.reserved,
     v_row.out_for_delivery, v_row.damaged, v_row.missing,
     v_row.awaiting_investigation)
  on conflict (agent_id, product_id) do nothing;

  case p_movement
    when 'Received from company' then
      v_row.available := v_row.available + p_quantity;
    when 'Reserved for order' then
      if v_row.available < p_quantity then raise exception 'INSUFFICIENT_PDA_STOCK|Only % unit(s) are available.', v_row.available; end if;
      v_row.available := v_row.available - p_quantity;
      v_row.reserved := v_row.reserved + p_quantity;
    when 'Released back to available' then
      if v_row.reserved < p_quantity then raise exception 'INSUFFICIENT_PDA_STOCK|Only % unit(s) are reserved.', v_row.reserved; end if;
      v_row.reserved := v_row.reserved - p_quantity;
      v_row.available := v_row.available + p_quantity;
    when 'Out for delivery' then
      if v_row.reserved < p_quantity then raise exception 'INSUFFICIENT_PDA_STOCK|Only % unit(s) are reserved.', v_row.reserved; end if;
      v_row.reserved := v_row.reserved - p_quantity;
      v_row.out_for_delivery := v_row.out_for_delivery + p_quantity;
    when 'Delivered to customer' then
      if v_row.out_for_delivery < p_quantity then raise exception 'INSUFFICIENT_PDA_STOCK|Only % unit(s) are out for delivery.', v_row.out_for_delivery; end if;
      v_row.out_for_delivery := v_row.out_for_delivery - p_quantity;
    when 'Returned to available' then
      if v_row.out_for_delivery < p_quantity then raise exception 'INSUFFICIENT_PDA_STOCK|Only % unit(s) are out for delivery.', v_row.out_for_delivery; end if;
      v_row.out_for_delivery := v_row.out_for_delivery - p_quantity;
      v_row.available := v_row.available + p_quantity;
    when 'Written off damaged' then
      if v_row.available < p_quantity then raise exception 'INSUFFICIENT_PDA_STOCK|Only % unit(s) are available.', v_row.available; end if;
      v_row.available := v_row.available - p_quantity;
      v_row.damaged := v_row.damaged + p_quantity;
    when 'Written off missing' then
      if v_row.available < p_quantity then raise exception 'INSUFFICIENT_PDA_STOCK|Only % unit(s) are available.', v_row.available; end if;
      v_row.available := v_row.available - p_quantity;
      v_row.missing := v_row.missing + p_quantity;
    when 'Under investigation' then
      if v_row.available < p_quantity then raise exception 'INSUFFICIENT_PDA_STOCK|Only % unit(s) are available.', v_row.available; end if;
      v_row.available := v_row.available - p_quantity;
      v_row.awaiting_investigation := v_row.awaiting_investigation + p_quantity;
    when 'Adjustment approved' then
      if v_row.awaiting_investigation < p_quantity then raise exception 'INSUFFICIENT_PDA_STOCK|Only % unit(s) are awaiting investigation.', v_row.awaiting_investigation; end if;
      v_row.awaiting_investigation := v_row.awaiting_investigation - p_quantity;
      v_row.available := v_row.available + p_quantity;
    when 'Returned to company' then
      if v_row.available < p_quantity then raise exception 'INSUFFICIENT_PDA_STOCK|Only % unit(s) are available.', v_row.available; end if;
      v_row.available := v_row.available - p_quantity;
  end case;

  update public.pda_agent_stock set
    available = v_row.available,
    reserved = v_row.reserved,
    out_for_delivery = v_row.out_for_delivery,
    damaged = v_row.damaged,
    missing = v_row.missing,
    awaiting_investigation = v_row.awaiting_investigation,
    updated_at = now()
  where id = v_row.id;

  insert into public.pda_stock_ledger (
    org_id, agent_id, product_id, product_name, movement, quantity,
    balance_after, order_id, transfer_id, note, recorded_by,
    recorded_by_name, idempotency_key
  ) values (
    p_org_id, p_agent_id, p_product_id, p_product_name, p_movement,
    p_quantity, v_row.available, p_order_id, p_transfer_id, p_note,
    p_recorded_by, p_recorded_by_name, p_idempotency_key
  );

  return jsonb_build_object(
    'duplicate', false,
    'available', v_row.available,
    'reserved', v_row.reserved,
    'outForDelivery', v_row.out_for_delivery,
    'damaged', v_row.damaged,
    'missing', v_row.missing,
    'awaitingInvestigation', v_row.awaiting_investigation
  );
end;
$$;

revoke all on function public.apply_pda_stock_movement(uuid, uuid, text, text, integer, text, text, text, uuid, text, uuid, text) from public;
revoke all on function public.apply_pda_stock_movement(uuid, uuid, text, text, integer, text, text, text, uuid, text, uuid, text) from anon, authenticated;
grant execute on function public.apply_pda_stock_movement(uuid, uuid, text, text, integer, text, text, text, uuid, text, uuid, text) to service_role;

create or replace view public.inventory_balance_reconciliation as
with current_balances as (
  select 'warehouse:' || p.id::text as scope_key, p.org_id, 'warehouse'::text as scope,
         p.id as product_id, null::uuid as agent_location_id, p.warehouse_stock as stored_quantity
  from public.products p
  union all
  select 'agent_location:' || s.agent_location_id::text || ':' || s.product_id::text,
         s.org_id, 'agent_location', s.product_id, s.agent_location_id, s.quantity
  from public.agent_location_stock s
), movement_deltas as (
  select b.scope_key,
         coalesce(sum(case
           when sm.source_scope = b.scope
            and (b.scope = 'warehouse' or sm.from_agent_location_id = b.agent_location_id) then -abs(sm.qty)
           when sm.destination_scope = b.scope
            and (b.scope = 'warehouse' or sm.to_agent_location_id = b.agent_location_id) then abs(sm.qty)
           else 0 end), 0)::integer as movement_delta
  from public.inventory_balance_baselines b
  left join public.stock_movements sm
    on sm.org_id = b.org_id and sm.product_id = b.product_id
   and sm.idempotency_key is not null and sm.created_at >= b.established_at
  group by b.scope_key
)
select b.org_id, b.scope, b.product_id, b.agent_location_id,
       coalesce(c.stored_quantity, 0)::integer as stored_quantity,
       (b.quantity + coalesce(d.movement_delta, 0))::integer as ledger_quantity,
       (coalesce(c.stored_quantity, 0) - b.quantity - coalesce(d.movement_delta, 0))::integer as drift
from public.inventory_balance_baselines b
left join current_balances c on c.scope_key = b.scope_key
left join movement_deltas d on d.scope_key = b.scope_key;

create or replace view public.inventory_aggregate_reconciliation as
with hub_agent as (
  select org_id, agent_id, product_id,
         sum(quantity)::integer as quantity,
         sum(defective)::integer as defective,
         sum(missing)::integer as missing
  from public.agent_location_stock group by org_id, agent_id, product_id
), agent_cache as (
  select a.org_id, s.agent_id, s.product_id, s.quantity, s.defective, s.missing
  from public.agent_stock s join public.agents a on a.id = s.agent_id
), product_hubs as (
  select org_id, product_id, sum(quantity)::integer as quantity
  from public.agent_location_stock group by org_id, product_id
)
select coalesce(h.org_id, c.org_id) as org_id,
       coalesce(h.product_id, c.product_id) as product_id,
       coalesce(h.agent_id, c.agent_id) as agent_id,
       coalesce(h.quantity, 0)::integer as hub_quantity,
       coalesce(c.quantity, 0)::integer as cached_quantity,
       (coalesce(c.quantity, 0) - coalesce(h.quantity, 0))::integer as quantity_drift,
       (coalesce(c.defective, 0) - coalesce(h.defective, 0))::integer as defective_drift,
       (coalesce(c.missing, 0) - coalesce(h.missing, 0))::integer as missing_drift,
       (coalesce(p.agent_stock, 0) - coalesce(ph.quantity, 0))::integer as product_cache_drift
from hub_agent h
full join agent_cache c on c.agent_id = h.agent_id and c.product_id = h.product_id
join public.products p on p.id = coalesce(h.product_id, c.product_id)
left join product_hubs ph on ph.org_id = p.org_id and ph.product_id = p.id;

create or replace view public.pda_inventory_reconciliation as
with movement_deltas as (
  select b.agent_id, b.product_id,
    coalesce(sum(case l.movement
      when 'Received from company' then l.quantity
      when 'Reserved for order' then -l.quantity
      when 'Released back to available' then l.quantity
      when 'Returned to available' then l.quantity
      when 'Written off damaged' then -l.quantity
      when 'Written off missing' then -l.quantity
      when 'Under investigation' then -l.quantity
      when 'Adjustment approved' then l.quantity
      when 'Returned to company' then -l.quantity
      else 0 end), 0)::integer as available_delta,
    coalesce(sum(case l.movement
      when 'Reserved for order' then l.quantity
      when 'Released back to available' then -l.quantity
      when 'Out for delivery' then -l.quantity
      else 0 end), 0)::integer as reserved_delta,
    coalesce(sum(case l.movement
      when 'Out for delivery' then l.quantity
      when 'Delivered to customer' then -l.quantity
      when 'Returned to available' then -l.quantity
      else 0 end), 0)::integer as out_for_delivery_delta,
    coalesce(sum(case when l.movement = 'Written off damaged' then l.quantity else 0 end), 0)::integer as damaged_delta,
    coalesce(sum(case when l.movement = 'Written off missing' then l.quantity else 0 end), 0)::integer as missing_delta,
    coalesce(sum(case l.movement
      when 'Under investigation' then l.quantity
      when 'Adjustment approved' then -l.quantity
      else 0 end), 0)::integer as awaiting_investigation_delta
  from public.pda_inventory_baselines b
  left join public.pda_stock_ledger l
    on l.org_id = b.org_id and l.agent_id = b.agent_id
   and l.product_id = b.product_id and l.idempotency_key is not null
   and l.created_at >= b.established_at
  group by b.agent_id, b.product_id
)
select b.org_id, b.agent_id, b.product_id,
  coalesce(s.available, 0)::integer as stored_available,
  (b.available + d.available_delta)::integer as ledger_available,
  (coalesce(s.available, 0) - b.available - d.available_delta)::integer as available_drift,
  coalesce(s.reserved, 0)::integer as stored_reserved,
  (b.reserved + d.reserved_delta)::integer as ledger_reserved,
  (coalesce(s.reserved, 0) - b.reserved - d.reserved_delta)::integer as reserved_drift,
  coalesce(s.out_for_delivery, 0)::integer as stored_out_for_delivery,
  (b.out_for_delivery + d.out_for_delivery_delta)::integer as ledger_out_for_delivery,
  (coalesce(s.out_for_delivery, 0) - b.out_for_delivery - d.out_for_delivery_delta)::integer as out_for_delivery_drift,
  (coalesce(s.damaged, 0) - b.damaged - d.damaged_delta)::integer as damaged_drift,
  (coalesce(s.missing, 0) - b.missing - d.missing_delta)::integer as missing_drift,
  (coalesce(s.awaiting_investigation, 0) - b.awaiting_investigation - d.awaiting_investigation_delta)::integer as awaiting_investigation_drift
from public.pda_inventory_baselines b
join movement_deltas d on d.agent_id = b.agent_id and d.product_id = b.product_id
left join public.pda_agent_stock s on s.agent_id = b.agent_id and s.product_id = b.product_id;

alter table public.inventory_balance_baselines enable row level security;
alter table public.pda_inventory_baselines enable row level security;
