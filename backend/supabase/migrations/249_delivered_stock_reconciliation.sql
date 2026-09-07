-- Human-controlled delivered-stock close.
-- Delivery records immutable pending product lines; reconciliation deducts
-- the physical hub balance and writes the stock ledger in one transaction.

alter table public.orders
  add column if not exists stock_reconciliation_status text not null default 'not_applicable',
  add column if not exists stock_reconciliation_lines_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists stock_reconciled_at timestamptz,
  add column if not exists stock_reconciled_by uuid references public.users(id) on delete set null;

do $$ begin
  alter table public.orders add constraint orders_stock_reconciliation_status_check
    check (stock_reconciliation_status in ('not_applicable','pending','partial','exception','reconciled','voided'));
exception when duplicate_object then null;
end $$;

create table if not exists public.delivered_stock_reconciliation_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id text not null,
  agent_id uuid not null references public.agents(id) on delete restrict,
  agent_location_id uuid not null references public.agent_locations(id) on delete restrict,
  state_snapshot text not null default '',
  agent_name_snapshot text not null default '',
  customer_snapshot text not null default '',
  product_id uuid not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  quantity integer not null check (quantity > 0),
  status text not null default 'pending'
    check (status in ('pending','exception','reconciled','voided','reversed')),
  delivery_cycle integer not null default 1 check (delivery_cycle > 0),
  delivered_at timestamptz not null default now(),
  reconciled_at timestamptz,
  reconciled_by uuid references public.users(id) on delete set null,
  reconciled_by_name text,
  movement_id text,
  issue_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, order_id, product_id)
);

create index if not exists delivered_stock_reconciliation_pending_idx
  on public.delivered_stock_reconciliation_lines (org_id, status, state_snapshot, agent_id, product_id);
create index if not exists delivered_stock_reconciliation_location_idx
  on public.delivered_stock_reconciliation_lines (org_id, agent_location_id, product_id, status);

alter table public.delivered_stock_reconciliation_lines enable row level security;
drop policy if exists delivered_stock_reconciliation_lines_select on public.delivered_stock_reconciliation_lines;
create policy delivered_stock_reconciliation_lines_select on public.delivered_stock_reconciliation_lines
  -- ⚠️ private.auth_org_id(), NOT public. Migration 092 moved the auth helpers
  -- into the private schema; there is no public.auth_org_id() on this project
  -- and the policy would fail to create. Every other org-scoped policy here
  -- (manager_product_challenges, product_dedicated_handlers, ...) reads it the
  -- same way, wrapped in a sub-select so the planner evaluates it once.
  for select using (org_id = (select private.auth_org_id()));

-- Existing delivered orders were deducted by the previous workflow. They are
-- historical reconciled stock, not new work for the officer.
update public.orders
set stock_reconciliation_status = case
  when status::text = 'Delivered' and stock_deducted then 'reconciled'
  when status::text = 'Delivered' then 'exception'
  else 'not_applicable'
end
where stock_reconciliation_status = 'not_applicable';

create or replace function public.capture_delivered_stock_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_product_id uuid;
  v_quantity integer;
  v_physical integer;
  v_reserved integer;
begin
  -- ⚠️ ONLY THE NEW DELIVERY PATH OPENS THIS QUEUE, and the gate is
  -- stock_reconciliation_status = 'pending', which ONLY the reconciliation-aware
  -- code writes.
  --
  -- Gating on the status transition alone would fire against the currently
  -- deployed code too, and that has two ugly consequences the moment this
  -- migration lands ahead of the release:
  --
  --   1. OUTAGE. The old path never fills stock_reconciliation_lines_snapshot,
  --      so the "Delivered inventory lines are required" raise below would
  --      abort EVERY attempt to mark an order Delivered.
  --   2. DOUBLE DEDUCTION. The old path also deducts immediately. A pending
  --      line captured beside that deduction is the same stock again, waiting
  --      for an officer to take it off a second time - the exact fault that
  --      already cost 275 units across 42 orders.
  --
  -- With this gate the migration is inert until the code that sets the status
  -- ships, so the two can be released in either order with no window between.
  if new.status::text = 'Delivered' and old.status::text is distinct from 'Delivered'
     and new.stock_reconciliation_status = 'pending' then
    if new.agent_id is null or new.agent_location_id is null then
      raise exception 'DELIVERED_STOCK_PENDING|An agent and stock location are required before delivery.';
    end if;
    if jsonb_typeof(new.stock_reconciliation_lines_snapshot) <> 'array'
       or jsonb_array_length(new.stock_reconciliation_lines_snapshot) = 0 then
      raise exception 'DELIVERED_STOCK_PENDING|Delivered inventory lines are required.';
    end if;

    for v_line in select value from jsonb_array_elements(new.stock_reconciliation_lines_snapshot)
    loop
      v_product_id := nullif(v_line->>'productId', '')::uuid;
      v_quantity := coalesce((v_line->>'quantity')::integer, 0);
      if v_product_id is null or v_quantity <= 0 then
        raise exception 'DELIVERED_STOCK_PENDING|Every delivered inventory line needs a product and quantity.';
      end if;

      -- Serialize delivery commitments for this exact hub/product. Pending
      -- stock remains visible in the physical balance, so the trigger reserves
      -- it here and refuses concurrent deliveries that would over-commit it.
      perform pg_advisory_xact_lock(hashtextextended(
        'delivered-stock:' || new.agent_location_id::text || ':' || v_product_id::text, 0
      ));
      select greatest(0, quantity - defective - missing) into v_physical
      from public.agent_location_stock
      where agent_location_id=new.agent_location_id and product_id=v_product_id
      for update;
      v_physical := coalesce(v_physical, 0);
      select coalesce(sum(quantity), 0) into v_reserved
      from public.delivered_stock_reconciliation_lines
      where org_id=new.org_id and agent_location_id=new.agent_location_id
        and product_id=v_product_id and status in ('pending','exception')
        and order_id <> new.id;
      if v_physical - v_reserved < v_quantity then
        raise exception 'INSUFFICIENT_STOCK|Only % unit(s) of % remain available after pending deliveries; % are required.',
          greatest(0, v_physical-v_reserved), coalesce(nullif(v_line->>'productName',''), v_product_id::text), v_quantity;
      end if;

      insert into public.delivered_stock_reconciliation_lines (
        org_id, order_id, agent_id, agent_location_id, state_snapshot,
        agent_name_snapshot, customer_snapshot, product_id,
        product_name_snapshot, quantity, status, delivered_at
      ) values (
        new.org_id, new.id, new.agent_id, new.agent_location_id,
        coalesce(new.agent_location_state_snapshot, new.state, ''),
        coalesce(new.agent_name_snapshot, ''), coalesce(new.customer, ''),
        v_product_id, coalesce(nullif(v_line->>'productName', ''), v_product_id::text),
        v_quantity, 'pending', coalesce(new.updated_at, now())
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
        issue_note = null,
        updated_at = now();
    end loop;

    new.stock_deducted := false;
    new.stock_reconciliation_status := 'pending';
    new.stock_reconciled_at := null;
    new.stock_reconciled_by := null;
  elsif old.status::text = 'Delivered' and new.status::text is distinct from 'Delivered' then
    update public.delivered_stock_reconciliation_lines
    set status = case when status = 'reconciled' then 'reversed' else 'voided' end,
        updated_at = now()
    where org_id = old.org_id and order_id = old.id
      and status in ('pending','exception','reconciled');
    new.stock_deducted := false;
    new.stock_reconciliation_status := 'voided';
    new.stock_reconciled_at := null;
    new.stock_reconciled_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_capture_delivered_stock_pending on public.orders;
create trigger trg_capture_delivered_stock_pending
  before update of status on public.orders
  for each row execute function public.capture_delivered_stock_pending();

create or replace function public.void_delivered_stock_on_order_delete()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  update public.delivered_stock_reconciliation_lines
  set status=case when status='reconciled' then 'reversed' else 'voided' end, updated_at=now()
  where org_id=old.org_id and order_id=old.id and status in ('pending','exception','reconciled');
  return old;
end;
$$;
drop trigger if exists trg_void_delivered_stock_on_order_delete on public.orders;
create trigger trg_void_delivered_stock_on_order_delete
  before delete on public.orders for each row execute function public.void_delivered_stock_on_order_delete();

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
    'movementId', 'MOV-DR-' || replace(l.id::text, '-', ''),
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
      movement_id = 'MOV-DR-' || replace(l.id::text, '-', ''),
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

create or replace function public.flag_delivered_stock_issue(
  p_org_id uuid,
  p_line_ids uuid[],
  p_note text,
  p_actor_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested integer := coalesce(array_length(p_line_ids, 1), 0);
  v_updated integer;
begin
  if v_requested = 0 or v_requested > 100 or nullif(trim(p_note), '') is null then
    raise exception 'INVALID_INVENTORY|Select delivered orders and describe the issue.';
  end if;
  perform 1 from public.delivered_stock_reconciliation_lines
  where org_id=p_org_id and id=any(p_line_ids)
  order by id for update;
  update public.delivered_stock_reconciliation_lines
  set status='exception', issue_note=trim(p_note), updated_at=now()
  where org_id=p_org_id and id=any(p_line_ids) and status='pending';
  get diagnostics v_updated = row_count;
  if v_updated <> v_requested then
    raise exception 'INVENTORY_CONFLICT|One or more delivered orders were already changed. Refresh and try again.';
  end if;
  update public.orders
  set stock_reconciliation_status='exception'
  where org_id=p_org_id
    and id in (select distinct order_id from public.delivered_stock_reconciliation_lines where org_id=p_org_id and id=any(p_line_ids));
  return v_updated;
end;
$$;

revoke all on function public.flag_delivered_stock_issue(uuid, uuid[], text, uuid) from public;
revoke all on function public.flag_delivered_stock_issue(uuid, uuid[], text, uuid) from anon, authenticated;
grant execute on function public.flag_delivered_stock_issue(uuid, uuid[], text, uuid) to service_role;

create or replace function public.resolve_delivered_stock_issue(
  p_org_id uuid,
  p_line_id uuid
)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_order_id text;
begin
  update public.delivered_stock_reconciliation_lines
  set status='pending', issue_note=null, updated_at=now()
  where org_id=p_org_id and id=p_line_id and status='exception'
  returning order_id into v_order_id;
  if v_order_id is null then
    raise exception 'INVENTORY_CONFLICT|That issue was already changed. Refresh and try again.';
  end if;
  update public.orders set stock_reconciliation_status=case
    when exists (select 1 from public.delivered_stock_reconciliation_lines where org_id=p_org_id and order_id=v_order_id and status='exception') then 'exception'
    when exists (select 1 from public.delivered_stock_reconciliation_lines where org_id=p_org_id and order_id=v_order_id and status='reconciled') then 'partial'
    else 'pending' end
  where org_id=p_org_id and id=v_order_id and status::text='Delivered';
  return true;
end;
$$;
revoke all on function public.resolve_delivered_stock_issue(uuid, uuid) from public;
revoke all on function public.resolve_delivered_stock_issue(uuid, uuid) from anon, authenticated;
grant execute on function public.resolve_delivered_stock_issue(uuid, uuid) to service_role;
